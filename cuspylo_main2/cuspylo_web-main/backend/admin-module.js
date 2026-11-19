// CUSPYLO Module 02 — Admin management API
// All admin management data is stored in Neon PostgreSQL.
module.exports = function registerAdminModule(app, pool, auth) {
  const clean = (v, max=200) => String(v ?? '').trim().slice(0,max);
  const adminOnly = auth('admin');

  const audit = async (action, entityType, entityId, details={}) => {
    await pool.query(
      `INSERT INTO admin_audit_log (action, entity_type, entity_id, details)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [action, entityType, String(entityId ?? ''), JSON.stringify(details)]
    );
  };

  // Dashboard summary
  app.get('/api/admin/v2/summary', adminOnly, async (_req,res) => {
    try {
      const [users, products] = await Promise.all([
        pool.query(`SELECT
          COUNT(*) FILTER (WHERE role='user' AND account_status='active')::int AS active_users,
          COUNT(*) FILTER (WHERE account_status='suspended')::int AS suspended_users,
          COUNT(*) FILTER (WHERE account_status='deleted')::int AS deleted_users,
          COUNT(*) FILTER (WHERE role='user')::int AS total_users
          FROM users`),
        pool.query(`SELECT COUNT(*)::int AS total_products,
          COUNT(*) FILTER (WHERE active=true)::int AS active_products
          FROM admin_products`)
      ]);
      const orders = await pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(total),0)::numeric AS revenue FROM orders`);
      res.json({users:users.rows[0], products:products.rows[0], orders:orders.rows[0]});
    } catch(e) {
      console.error('Admin summary:',e.message);
      res.status(500).json({error:'Unable to load dashboard summary.'});
    }
  });

  // Customer list with combined server-side filters
  app.get('/api/admin/v2/users', adminOnly, async (req,res) => {
    try {
      const q=clean(req.query.q,120), college=clean(req.query.college,120),
        year=clean(req.query.year,30), status=clean(req.query.status,20);
      const r=await pool.query(
        `SELECT id,name,username,phone,email,college,academic_year,role,
                account_status,created_at,deleted_at
         FROM users
         WHERE role IN ('user','deleted')
           AND ($1='' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%')
           AND ($2='' OR college=$2)
           AND ($3='' OR academic_year::text=$3)
           AND ($4='' OR account_status=$4)
         ORDER BY created_at DESC NULLS LAST`,
        [q,college,year,status]);
      res.json({users:r.rows});
    } catch(e) {
      console.error('Admin users:',e.message);
      res.status(500).json({error:'Unable to load students.'});
    }
  });

  // Distinct values for filter controls
  app.get('/api/admin/v2/filter-options', adminOnly, async (_req,res) => {
    try {
      const [c,y,s]=await Promise.all([
        pool.query(`SELECT DISTINCT college FROM users WHERE college IS NOT NULL AND college<>'' ORDER BY college`),
        pool.query(`SELECT DISTINCT academic_year::text AS year FROM users WHERE academic_year IS NOT NULL AND academic_year::text<>'' ORDER BY year`),
        pool.query(`SELECT DISTINCT subject FROM admin_products WHERE subject IS NOT NULL AND subject<>'' ORDER BY subject`)
      ]);
      res.json({colleges:c.rows.map(x=>x.college),years:y.rows.map(x=>x.year),subjects:s.rows.map(x=>x.subject)});
    } catch(e) {
      res.status(500).json({error:'Unable to load filter options.'});
    }
  });

  // Suspend / restore account. Deleted accounts cannot be restored here.
  app.patch('/api/admin/v2/users/:id/status', adminOnly, async (req,res) => {
    const status=clean(req.body?.status,20);
    if(!['active','suspended'].includes(status))
      return res.status(400).json({error:'Status must be active or suspended.'});
    try {
      const r=await pool.query(
        `UPDATE users SET account_status=$1, updated_at=NOW()
         WHERE id=$2 AND role='user' AND account_status<>'deleted'
         RETURNING id,name,account_status`,
        [status,req.params.id]);
      if(!r.rowCount) return res.status(404).json({error:'Student not found or already deleted.'});
      await audit(status==='suspended'?'STUDENT_SUSPENDED':'STUDENT_RESTORED','user',req.params.id,{});
      res.json({user:r.rows[0]});
    } catch(e) {
      console.error('Admin status:',e.message);
      res.status(500).json({error:'Unable to update student status.'});
    }
  });

  // Soft-delete account and anonymize linked order/request PII in one transaction.
  app.delete('/api/admin/v2/users/:id', adminOnly, async (req,res) => {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const r=await client.query(`SELECT id FROM users WHERE id=$1 AND role='user' FOR UPDATE`,[req.params.id]);
      if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Student not found.'});}
      const id=r.rows[0].id, anonymized=`deleted-user-${id}`;
      const orders=await client.query(`UPDATE orders SET customer_name='Deleted user',customer_phone='',customer_email=NULL,college=NULL,address=NULL,user_id=NULL,updated_at=NOW() WHERE user_id=$1`,[id]);
      const requests=await client.query(`UPDATE product_requests SET customer_name='Deleted user',contact=NULL,user_id=NULL,updated_at=NOW() WHERE user_id=$1`,[id]);
      await client.query(`UPDATE feedback SET customer_name='Deleted user',contact=NULL,user_id=NULL WHERE user_id=$1`,[id]);
      await client.query(`UPDATE users SET name='Deleted user',username=$1,email=NULL,phone=$2,college=NULL,academic_year=NULL,pincode=NULL,password_hash='!DELETED!',role='deleted',account_status='deleted',deleted_at=NOW(),updated_at=NOW() WHERE id=$3`,[anonymized,`deleted-${id}`,id]);
      await client.query(`INSERT INTO admin_audit_log(action,entity_type,entity_id,details) VALUES('STUDENT_DELETED','user',$1,$2::jsonb)`,[id,JSON.stringify({relatedOrdersAnonymized:orders.rowCount,relatedRequestsAnonymized:requests.rowCount})]);
      await client.query('COMMIT');
      res.json({ok:true,deleted:true,ordersAnonymized:orders.rowCount,requestsAnonymized:requests.rowCount});
    } catch(e) { try{await client.query('ROLLBACK');}catch{} console.error('Admin delete:',e.message); res.status(500).json({error:'Unable to delete student account.'}); }
    finally {client.release();}
  });

  // Product catalogue and multi-image management.
  app.get('/api/admin/v2/products', adminOnly, async (_req,res) => {
    try { const r=await pool.query(`SELECT id,name,sku,subject,price,active,created_at,updated_at,description,image_data,category,academic_year,product_type,multi_images,store_group,search_keywords,stock_quantity,quality_note,pdf_filename,(resource_pdf IS NOT NULL) AS has_pdf,octet_length(resource_pdf) AS pdf_size FROM admin_products ORDER BY created_at DESC`); res.json({products:r.rows}); }
    catch(e){console.error(e.message);res.status(500).json({error:'Unable to load products.'});}
  });
  const normalizeImages = b => {
    const arr=Array.isArray(b.multi_images)?b.multi_images:[];
    const valid=arr.filter(x=>typeof x==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(x)&&x.length<=2_700_000).slice(0,3);
    if(!valid.length&&typeof b.image_data==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(b.image_data)&&b.image_data.length<=2_700_000)valid.push(b.image_data);
    return valid;
  };
  const normalizeResourcePdf = b => {
    if (typeof b.pdf_data !== 'string' || !b.pdf_data) return null;
    const match = b.pdf_data.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Upload a valid PDF document.');
    const data = Buffer.from(match[1], 'base64');
    if (!data.length || data.length > 15 * 1024 * 1024) throw new Error('PDF must be 15 MB or smaller.');
    if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('The uploaded file is not a valid PDF.');
    return { data, filename: clean(b.pdf_filename || 'resource.pdf', 180).replace(/[\\/\\r\\n]/g, '_') || 'resource.pdf' };
  };
  const isAcademicResource = type => ['Notes','PYQs','Mind Maps'].includes(type);
  app.post('/api/admin/v2/products', adminOnly, async (req,res) => {
    const b=req.body||{},name=clean(b.name,160),sku=clean(b.sku,80),subject=clean(b.subject||'Universal',100)||'Universal',price=Number(b.price);
    const types=['Dental Store','Notes','Mind Maps','Quiz','PYQs','Books','Other'],type=types.includes(b.product_type)?b.product_type:'Dental Store';
    const images=normalizeImages(b),category=clean(b.category||'General',100),year=clean(b.academic_year||'Universal',30)||'Universal';
    const stock=Math.max(0,Math.floor(Number(b.stock_quantity)||0));
    if(!name||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Product name and valid price are required.'});
    if(Array.isArray(b.multi_images)&&b.multi_images.length>3)return res.status(400).json({error:'Maximum 3 product images are allowed.'});
    if(b.multi_images?.some(x=>typeof x!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(x)||x.length>2_700_000))return res.status(400).json({error:'Use PNG, JPG or WEBP images under 2 MB each.'});
    let pdf;
    try { pdf = normalizeResourcePdf(b); } catch(e) { return res.status(400).json({error:e.message}); }
    if(isAcademicResource(type) && !pdf)return res.status(400).json({error:'Upload the PDF file for Notes, PYQs or Mind Maps.'});
    try{
      const r=await pool.query(`INSERT INTO admin_products(name,sku,subject,price,description,image_data,category,academic_year,product_type,multi_images,store_group,search_keywords,stock_quantity,quality_note,resource_pdf,pdf_filename)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING id,name,product_type,pdf_filename,(resource_pdf IS NOT NULL) AS has_pdf`,[name,sku||null,subject,price,clean(b.description,3000),images[0]||'',category,year,type,JSON.stringify(images),clean(b.store_group||'DENTAL_STORE',40),clean(b.search_keywords,1000),stock,clean(b.quality_note,1000),pdf?.data||null,pdf?.filename||null]);
      await audit('PRODUCT_CREATED','product',r.rows[0].id,{name,subject,category,year,product_type:type});res.status(201).json({product:r.rows[0]});
    }catch(e){if(e.code==='23505')return res.status(409).json({error:'That SKU already exists.'});console.error(e.message);res.status(500).json({error:'Unable to create product.'});}
  });
  app.patch('/api/admin/v2/products/:id', adminOnly, async (req,res) => {
    const b=req.body||{},name=clean(b.name,160),sku=clean(b.sku,80),subject=clean(b.subject||'Universal',100)||'Universal',price=Number(b.price);
    const types=['Dental Store','Notes','Mind Maps','Quiz','PYQs','Books','Other'],type=types.includes(b.product_type)?b.product_type:'Other',images=normalizeImages(b);
    if(!name||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Product name and valid price are required.'});
    if(Array.isArray(b.multi_images)&&b.multi_images.length>3)return res.status(400).json({error:'Maximum 3 product images are allowed.'});
    if(b.multi_images?.some(x=>typeof x!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(x)||x.length>2_700_000))return res.status(400).json({error:'Use PNG, JPG or WEBP images under 2 MB each.'});
    let pdf;
    try { pdf = normalizeResourcePdf(b); } catch(e) { return res.status(400).json({error:e.message}); }
    try{
      if(isAcademicResource(type) && !pdf) {
        const existing = await pool.query(`SELECT resource_pdf IS NOT NULL AS has_pdf FROM admin_products WHERE id=$1`,[req.params.id]);
        if(!existing.rowCount)return res.status(404).json({error:'Product not found.'});
        if(!existing.rows[0].has_pdf)return res.status(400).json({error:'Upload the PDF file for Notes, PYQs or Mind Maps.'});
      }
      const r=await pool.query(`UPDATE admin_products SET name=$1,sku=$2,subject=$3,price=$4,active=$5,description=$6,image_data=$7,category=$8,academic_year=$9,product_type=$10,multi_images=$11::jsonb,store_group=$12,search_keywords=$13,stock_quantity=$14,quality_note=$15,resource_pdf=COALESCE($16,resource_pdf),pdf_filename=COALESCE($17,pdf_filename),updated_at=NOW() WHERE id=$18 RETURNING id,name,product_type,pdf_filename,(resource_pdf IS NOT NULL) AS has_pdf`,
      [name,sku||null,subject,price,b.active!==false,clean(b.description,3000),images[0]||'',clean(b.category||'General',100),clean(b.academic_year||'Universal',30),type,JSON.stringify(images),clean(b.store_group||'DENTAL_STORE',40),clean(b.search_keywords,1000),Math.max(0,Math.floor(Number(b.stock_quantity)||0)),clean(b.quality_note,1000),pdf?.data||null,pdf?.filename||null,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Product not found.'});await audit('PRODUCT_UPDATED','product',req.params.id,{name,subject,product_type:type,active:b.active!==false,has_pdf:!!r.rows[0].has_pdf});res.json({product:r.rows[0]});
    }catch(e){console.error(e.message);res.status(500).json({error:'Unable to update product.'});}
  });

  // Subject master for dependent year/subject selectors.
  app.get('/api/admin/v2/subjects',adminOnly,async(_req,res)=>{try{const r=await pool.query(`SELECT * FROM academic_subjects ORDER BY academic_year,sort_order,subject_name`);res.json({subjects:r.rows});}catch(e){res.status(500).json({error:'Unable to load subjects.'});}});
  app.post('/api/admin/v2/subjects',adminOnly,async(req,res)=>{const y=clean(req.body?.academic_year,30),n=clean(req.body?.subject_name,100);if(!y||!n)return res.status(400).json({error:'Year and subject are required.'});try{const r=await pool.query(`INSERT INTO academic_subjects(academic_year,subject_name) VALUES($1,$2) ON CONFLICT(academic_year,subject_name) DO UPDATE SET active=true RETURNING *`,[y,n]);res.status(201).json({subject:r.rows[0]});}catch(e){res.status(500).json({error:'Unable to save subject.'});}});

  // Admin-curated kits assembled from existing catalogue products.
  
  // Admin-curated kits: create, edit, hide/publish and delete.
  app.get('/api/admin/v2/kits',adminOnly,async(_req,res)=>{
    try{
      const r=await pool.query(`
        SELECT k.*,
          COALESCE(
            json_agg(json_build_object(
              'product_id',p.id,
              'name',p.name,
              'price',p.price,
              'quantity',ki.quantity
            )) FILTER(WHERE p.id IS NOT NULL),
            '[]'::json
          ) AS items,
          COALESCE(SUM(p.price*ki.quantity),0)::numeric AS total_price
        FROM admin_kits k
        LEFT JOIN admin_kit_items ki ON ki.kit_id=k.id
        LEFT JOIN admin_products p ON p.id=ki.product_id
        GROUP BY k.id
        ORDER BY k.created_at DESC
      `);
      res.json({kits:r.rows});
    }catch(e){
      console.error('Load kits:',e.message);
      res.status(500).json({error:'Unable to load kits.'});
    }
  });

  const normalizeKitItems = items => {
    if(!Array.isArray(items))return [];
    const merged=new Map();
    for(const item of items){
      const id=Number(item.product_id);
      const qty=Math.floor(Number(item.quantity)||0);
      if(!Number.isSafeInteger(id)||id<=0||qty<1||qty>99)continue;
      merged.set(id,(merged.get(id)||0)+qty);
    }
    return [...merged.entries()]
      .filter(([,qty])=>qty<=99)
      .map(([id,qty])=>({id,qty}));
  };

  const validateKitBody = b => {
    const name=clean(b.name,160);
    const type=clean(b.kit_type,40);
    const year=clean(b.academic_year||'Universal',30);
    const subject=clean(b.subject||'Universal',100);
    const description=clean(b.description,3000);
    const disclosure=clean(b.quality_disclosure,1000);
    const allowed=['PREMIUM','HIGH_PERFORMANCE','BALANCED','ECONOMY','CUSTOMIZABLE'];
    const items=normalizeKitItems(b.items);

    if(!name||!allowed.includes(type)||!items.length){
      return {error:'Kit name, valid type and at least one valid product are required.'};
    }
    if(type==='ECONOMY'&&!disclosure){
      return {error:'Economy kits must disclose lower-grade product specifications.'};
    }
    return {name,type,year,subject,description,disclosure,items};
  };

  app.post('/api/admin/v2/kits',adminOnly,async(req,res)=>{
    const data=validateKitBody(req.body||{});
    if(data.error)return res.status(400).json({error:data.error});

    const client=await pool.connect();
    try{
      await client.query('BEGIN');

      const ids=data.items.map(x=>x.id);
      const products=await client.query(
        `SELECT id,active FROM admin_products WHERE id=ANY($1::bigint[])`,
        [ids]
      );

      if(products.rowCount!==ids.length||products.rows.some(p=>!p.active)){
        await client.query('ROLLBACK');
        return res.status(400).json({error:'One or more selected products are unavailable.'});
      }

      const kit=await client.query(`
        INSERT INTO admin_kits
          (name,kit_type,academic_year,subject,description,quality_disclosure)
        VALUES($1,$2,$3,$4,$5,$6)
        RETURNING *
      `,[data.name,data.type,data.year,data.subject,data.description,data.disclosure]);

      for(const item of data.items){
        await client.query(
          `INSERT INTO admin_kit_items(kit_id,product_id,quantity)
           VALUES($1,$2,$3)`,
          [kit.rows[0].id,item.id,item.qty]
        );
      }

      await audit('KIT_CREATED','kit',kit.rows[0].id,{
        name:data.name,
        productCount:data.items.length
      });

      await client.query('COMMIT');
      res.status(201).json({kit:kit.rows[0]});
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      console.error('Create kit:',e.message);
      res.status(500).json({error:'Unable to create kit.'});
    }finally{
      client.release();
    }
  });

  // Edit kit details and replace its product/quantity selection atomically.
  app.patch('/api/admin/v2/kits/:id',adminOnly,async(req,res)=>{
    const data=validateKitBody(req.body||{});
    if(data.error)return res.status(400).json({error:data.error});

    const client=await pool.connect();
    try{
      await client.query('BEGIN');

      const existing=await client.query(
        `SELECT id FROM admin_kits WHERE id=$1 FOR UPDATE`,
        [req.params.id]
      );
      if(!existing.rowCount){
        await client.query('ROLLBACK');
        return res.status(404).json({error:'Kit not found.'});
      }

      const ids=data.items.map(x=>x.id);
      const products=await client.query(
        `SELECT id,active FROM admin_products WHERE id=ANY($1::bigint[])`,
        [ids]
      );

      if(products.rowCount!==ids.length||products.rows.some(p=>!p.active)){
        await client.query('ROLLBACK');
        return res.status(400).json({error:'One or more selected products are unavailable.'});
      }

      await client.query(`
        UPDATE admin_kits
        SET name=$1,kit_type=$2,academic_year=$3,subject=$4,
            description=$5,quality_disclosure=$6,updated_at=NOW()
        WHERE id=$7
      `,[
        data.name,data.type,data.year,data.subject,
        data.description,data.disclosure,req.params.id
      ]);

      await client.query(
        `DELETE FROM admin_kit_items WHERE kit_id=$1`,
        [req.params.id]
      );

      for(const item of data.items){
        await client.query(
          `INSERT INTO admin_kit_items(kit_id,product_id,quantity)
           VALUES($1,$2,$3)`,
          [req.params.id,item.id,item.qty]
        );
      }

      await audit('KIT_UPDATED','kit',req.params.id,{
        name:data.name,
        productCount:data.items.length
      });

      await client.query('COMMIT');
      res.json({ok:true});
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      console.error('Update kit:',e.message);
      res.status(500).json({error:'Unable to update kit.'});
    }finally{
      client.release();
    }
  });

  // Hide or publish a kit without deleting it.
  app.patch('/api/admin/v2/kits/:id/status',adminOnly,async(req,res)=>{
    if(typeof req.body?.active!=='boolean'){
      return res.status(400).json({error:'A valid active status is required.'});
    }
    try{
      const r=await pool.query(
        `UPDATE admin_kits
         SET active=$1,updated_at=NOW()
         WHERE id=$2
         RETURNING id,name,active`,
        [req.body.active,req.params.id]
      );
      if(!r.rowCount)return res.status(404).json({error:'Kit not found.'});

      await audit(
        req.body.active?'KIT_PUBLISHED':'KIT_HIDDEN',
        'kit',req.params.id,{name:r.rows[0].name}
      );

      res.json({kit:r.rows[0]});
    }catch(e){
      console.error('Kit visibility:',e.message);
      res.status(500).json({error:'Unable to update kit visibility.'});
    }
  });

  // Permanently delete a kit and its kit-item rows in one transaction.
  app.delete('/api/admin/v2/kits/:id',adminOnly,async(req,res)=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');

      const found=await client.query(
        `SELECT id,name FROM admin_kits WHERE id=$1 FOR UPDATE`,
        [req.params.id]
      );
      if(!found.rowCount){
        await client.query('ROLLBACK');
        return res.status(404).json({error:'Kit not found.'});
      }

      await client.query(
        `DELETE FROM admin_kit_items WHERE kit_id=$1`,
        [req.params.id]
      );

      await client.query(
        `DELETE FROM admin_kits WHERE id=$1`,
        [req.params.id]
      );

      await audit('KIT_DELETED','kit',req.params.id,{
        name:found.rows[0].name
      });

      await client.query('COMMIT');
      res.json({ok:true});
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      console.error('Delete kit:',e.message);
      res.status(500).json({
        error:'Unable to delete this kit. It may be referenced by other records; hide it instead.'
      });
    }finally{
      client.release();
    }
  });


  // Order archive — filters and tracking are queried directly from Neon.
  app.get('/api/admin/v2/orders', adminOnly, async (req,res) => {
    const q=clean(req.query.q,120), college=clean(req.query.college,120),
      year=clean(req.query.year,30), subject=clean(req.query.subject,100), status=clean(req.query.status,40),
      from=clean(req.query.from,10), to=clean(req.query.to,10);
    const statusMap={'Received':'RECEIVED','Packed':'PACKED','Out for Delivery':'OUT_FOR_DELIVERY','Completed':'DELIVERED','Delivered':'DELIVERED','Cancelled':'CANCELLED'};
    try {
      const r=await pool.query(`
        SELECT o.*,u.academic_year, (u.account_status='deleted' OR o.user_id IS NULL) AS customer_deleted,
          COALESCE(json_agg(json_build_object('item_type',oi.item_type,'item_name',oi.item_name,'product_id',oi.product_id,'fdi_number',oi.fdi_number,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total)) FILTER(WHERE oi.id IS NOT NULL),'[]'::json) AS line_items,
          COALESCE((SELECT json_agg(json_build_object('status',h.new_status,'at',h.created_at) ORDER BY h.created_at) FROM order_status_history h WHERE h.order_id=o.id),'[]'::json) AS tracking
        FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN order_items oi ON oi.order_id=o.id
        WHERE ($1='' OR o.invoice ILIKE '%'||$1||'%' OR o.customer_name ILIKE '%'||$1||'%' OR o.customer_phone ILIKE '%'||$1||'%' OR COALESCE(o.customer_email,'') ILIKE '%'||$1||'%')
          AND ($2='' OR COALESCE(o.college,'')=$2)
          AND ($3='' OR COALESCE(u.academic_year,'')=$3)
          AND ($4='' OR ($4='Unassigned' AND NOT EXISTS(SELECT 1 FROM order_items sx WHERE sx.order_id=o.id AND COALESCE(sx.metadata->>'subject','')<>'')) OR EXISTS(SELECT 1 FROM order_items sx WHERE sx.order_id=o.id AND sx.metadata->>'subject'=$4))
          AND ($5='' OR o.order_status=$5)
          AND ($6='' OR o.created_at::date >= NULLIF($6,'')::date)
          AND ($7='' OR o.created_at::date <= NULLIF($7,'')::date)
        GROUP BY o.id,u.academic_year,u.account_status ORDER BY o.created_at DESC`,
        [q,college,year,subject,statusMap[status]||status,from,to]);
      const orders=r.rows.map(o=>{
        const lineItems=o.line_items||[], items=lineItems.map(x=>({product_id:x.product_id,name:x.item_name,quantity:Number(x.quantity||1),price:Number(x.unit_price||0)}));
        const names={RECEIVED:'Received',PACKED:'Packed',OUT_FOR_DELIVERY:'Out for Delivery',DELIVERED:'Completed',CANCELLED:'Cancelled'};
        return {id:o.id,invoice:o.invoice,name:o.customer_name,phone:o.customer_phone,email:o.customer_email||'',college:o.college||'',academicYear:o.academic_year||'',address:o.address||'',items,lineItems,total:Number(o.total),unit:lineItems[0]?Number(lineItems[0].unit_price):0,payment:o.payment_method,status:names[o.order_status]||o.order_status,date:o.created_at,tracking:(o.tracking||[]).map(h=>({...h,status:({RECEIVED:'Received',PACKED:'Packed',OUT_FOR_DELIVERY:'Out for Delivery',DELIVERED:'Delivered',CANCELLED:'Cancelled'}[h.status]||h.status)})),customerDeleted:!!o.customer_deleted};
      });
      res.json({orders});
    } catch(e) { console.error('Admin orders:',e.message); res.status(500).json({error:'Unable to filter orders.'}); }
  });

  app.get('/api/admin/v2/audit', adminOnly, async (_req,res)=>{
    try{
      const r=await pool.query(`SELECT id,action,entity_type,entity_id,details,created_at
        FROM admin_audit_log ORDER BY created_at DESC LIMIT 200`);
      res.json({events:r.rows});
    }catch(e){res.status(500).json({error:'Unable to load audit log.'});}
  });

  // FAQ management
  app.get('/api/admin/v2/faqs', adminOnly, async (_req,res) => {
    try {
      const r=await pool.query(`SELECT id,question,answer,sort_order,published,created_at,updated_at
        FROM faqs ORDER BY sort_order ASC, id DESC`);
      res.json({faqs:r.rows});
    } catch(e) { console.error('Admin FAQs:',e.message); res.status(500).json({error:'Unable to load FAQs. Run the FAQ/Join Us SQL migration first.'}); }
  });
  app.post('/api/admin/v2/faqs', adminOnly, async (req,res) => {
    const question=clean(req.body?.question,500), answer=String(req.body?.answer??'').trim().slice(0,10000);
    const sort=Number.isInteger(Number(req.body?.sort_order))?Number(req.body.sort_order):0;
    if(!question||!answer)return res.status(400).json({error:'Question and answer are required.'});
    try {
      const r=await pool.query(`INSERT INTO faqs(question,answer,sort_order,published)
        VALUES($1,$2,$3,$4) RETURNING *`,[question,answer,sort,req.body?.published===true]);
      await audit('FAQ_CREATED','faq',r.rows[0].id,{question});
      res.status(201).json({faq:r.rows[0]});
    } catch(e) { console.error('Create FAQ:',e.message); res.status(500).json({error:'Unable to create FAQ.'}); }
  });
  app.patch('/api/admin/v2/faqs/:id', adminOnly, async (req,res) => {
    const question=clean(req.body?.question,500), answer=String(req.body?.answer??'').trim().slice(0,10000);
    const sort=Number.isInteger(Number(req.body?.sort_order))?Number(req.body.sort_order):0;
    if(!question||!answer)return res.status(400).json({error:'Question and answer are required.'});
    try {
      const r=await pool.query(`UPDATE faqs SET question=$1,answer=$2,sort_order=$3,published=$4,updated_at=NOW()
        WHERE id=$5 RETURNING *`,[question,answer,sort,req.body?.published===true,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'FAQ not found.'});
      await audit('FAQ_UPDATED','faq',req.params.id,{question,published:req.body?.published===true});
      res.json({faq:r.rows[0]});
    } catch(e) { console.error('Update FAQ:',e.message); res.status(500).json({error:'Unable to update FAQ.'}); }
  });
  app.delete('/api/admin/v2/faqs/:id', adminOnly, async (req,res) => {
    try {
      const r=await pool.query(`DELETE FROM faqs WHERE id=$1 RETURNING id,question`,[req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'FAQ not found.'});
      await audit('FAQ_DELETED','faq',req.params.id,{question:r.rows[0].question});
      res.json({ok:true});
    } catch(e) { console.error('Delete FAQ:',e.message); res.status(500).json({error:'Unable to delete FAQ.'}); }
  });

  // Product review moderation. Public visibility is limited to PUBLISHED reviews.
  app.get('/api/admin/v2/reviews', adminOnly, async (_req,res) => {
    try {
      const r=await pool.query(`SELECT pr.*,p.name AS product_name,u.name AS reviewer,o.invoice
        FROM product_reviews pr JOIN admin_products p ON p.id=pr.product_id
        LEFT JOIN users u ON u.id=pr.user_id JOIN orders o ON o.id=pr.order_id
        ORDER BY CASE pr.status WHEN 'PENDING' THEN 0 ELSE 1 END,pr.created_at DESC`);
      res.json({reviews:r.rows});
    } catch(e) { console.error('Admin reviews:',e.message); res.status(500).json({error:'Unable to load reviews. Run the Module 03 SQL migration.'}); }
  });
  app.patch('/api/admin/v2/reviews/:id', adminOnly, async (req,res) => {
    const status=clean(req.body?.status,20);
    if(!['PUBLISHED','REJECTED','PENDING'].includes(status))return res.status(400).json({error:'Invalid review status.'});
    try {
      const r=await pool.query(`UPDATE product_reviews SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status`,[status,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Review not found.'});
      await audit('PRODUCT_REVIEW_MODERATED','product_review',req.params.id,{status});
      res.json({review:r.rows[0]});
    } catch(e) { console.error('Moderate review:',e.message); res.status(500).json({error:'Unable to moderate review.'}); }
  });
  app.get('/api/admin/v2/private-feedback', adminOnly, async (_req,res) => {
    try {
      const r=await pool.query(`SELECT f.*,o.invoice,p.name AS product_name FROM feedback f LEFT JOIN orders o ON o.id=f.order_id LEFT JOIN admin_products p ON p.id=f.product_id WHERE f.feedback_type='ORDER_PRIVATE' ORDER BY f.created_at DESC`);
      res.json({feedback:r.rows});
    } catch(e) { console.error('Private feedback:',e.message); res.status(500).json({error:'Unable to load private feedback.'}); }
  });

  // Join Us opportunity management
  app.get('/api/admin/v2/opportunities', adminOnly, async (_req,res) => {
    try {
      const r=await pool.query(`SELECT id,title,description,requirements,location,work_type,application_url,status,created_at,updated_at
        FROM join_us_opportunities ORDER BY created_at DESC`);
      res.json({opportunities:r.rows});
    } catch(e) { console.error('Admin opportunities:',e.message); res.status(500).json({error:'Unable to load opportunities. Run the FAQ/Join Us SQL migration first.'}); }
  });
  app.post('/api/admin/v2/opportunities', adminOnly, async (req,res) => {
    const b=req.body||{}, title=clean(b.title,160), description=String(b.description??'').trim().slice(0,10000);
    const requirements=String(b.requirements??'').trim().slice(0,5000), location=clean(b.location,160), workType=clean(b.work_type,60);
    const url=clean(b.application_url,1000), status=['DRAFT','PUBLISHED','CLOSED'].includes(b.status)?b.status:'DRAFT';
    if(!title||!description)return res.status(400).json({error:'Role title and description are required.'});
    if(url && !/^https:\/\/\S+$/i.test(url))return res.status(400).json({error:'Application link must be a valid HTTPS URL.'});
    try {
      const r=await pool.query(`INSERT INTO join_us_opportunities(title,description,requirements,location,work_type,application_url,status)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[title,description,requirements,location,workType,url,status]);
      await audit('OPPORTUNITY_CREATED','join_us_opportunity',r.rows[0].id,{title,status});
      res.status(201).json({opportunity:r.rows[0]});
    } catch(e) { console.error('Create opportunity:',e.message); res.status(500).json({error:'Unable to create opportunity.'}); }
  });
  app.patch('/api/admin/v2/opportunities/:id', adminOnly, async (req,res) => {
    const b=req.body||{}, title=clean(b.title,160), description=String(b.description??'').trim().slice(0,10000);
    const requirements=String(b.requirements??'').trim().slice(0,5000), location=clean(b.location,160), workType=clean(b.work_type,60);
    const url=clean(b.application_url,1000), status=['DRAFT','PUBLISHED','CLOSED'].includes(b.status)?b.status:'DRAFT';
    if(!title||!description)return res.status(400).json({error:'Role title and description are required.'});
    if(url && !/^https:\/\/\S+$/i.test(url))return res.status(400).json({error:'Application link must be a valid HTTPS URL.'});
    try {
      const r=await pool.query(`UPDATE join_us_opportunities SET title=$1,description=$2,requirements=$3,location=$4,work_type=$5,application_url=$6,status=$7,updated_at=NOW()
        WHERE id=$8 RETURNING *`,[title,description,requirements,location,workType,url,status,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Opportunity not found.'});
      await audit('OPPORTUNITY_UPDATED','join_us_opportunity',req.params.id,{title,status});
      res.json({opportunity:r.rows[0]});
    } catch(e) { console.error('Update opportunity:',e.message); res.status(500).json({error:'Unable to update opportunity.'}); }
  });
  app.delete('/api/admin/v2/opportunities/:id', adminOnly, async (req,res) => {
    try {
      const r=await pool.query(`DELETE FROM join_us_opportunities WHERE id=$1 RETURNING id,title`,[req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Opportunity not found.'});
      await audit('OPPORTUNITY_DELETED','join_us_opportunity',req.params.id,{title:r.rows[0].title});
      res.json({ok:true});
    } catch(e) { console.error('Delete opportunity:',e.message); res.status(500).json({error:'Unable to delete opportunity.'}); }
  });


  // Public academic subject list used by the student year/subject selectors.
  app.get('/api/academic/subjects', auth('user'), async (req,res) => {
    const year=clean(req.query.year,30);
    if(!year)return res.status(400).json({error:'Academic year is required.'});
    try { const r=await pool.query(`SELECT subject_name FROM academic_subjects WHERE academic_year=$1 AND active=true ORDER BY sort_order,subject_name`,[year]); res.json({subjects:r.rows.map(x=>x.subject_name)}); }
    catch(e) { console.error('Academic subjects:',e.message); res.status(500).json({error:'Unable to load subjects.'}); }
  });

  // Quiz question bank — separate from the product catalogue.
  app.get('/api/admin/v2/quizzes', adminOnly, async (req,res) => {
    try {
      const q=clean(req.query.q,250), year=clean(req.query.year,30), subject=clean(req.query.subject,100), status=clean(req.query.status,20);
      const r=await pool.query(`SELECT id,question,option_a,option_b,option_c,option_d,correct_option,explanation,academic_year,subject,published,created_at,updated_at
        FROM quiz_questions WHERE ($1='' OR academic_year=$1) AND ($2='' OR subject=$2)
        AND ($3='' OR question ILIKE '%'||$3||'%' OR option_a ILIKE '%'||$3||'%' OR option_b ILIKE '%'||$3||'%' OR option_c ILIKE '%'||$3||'%' OR option_d ILIKE '%'||$3||'%')
        AND ($4='' OR ($4='published' AND published=true) OR ($4='draft' AND published=false))
        ORDER BY academic_year,subject,created_at DESC`,[year,subject,q,status]);
      res.json({questions:r.rows});
    } catch(e) { console.error('Admin quiz list:',e.message); res.status(500).json({error:'Unable to load quiz questions. Run Module 04 migration.'}); }
  });
  app.post('/api/admin/v2/quizzes', adminOnly, async (req,res) => {
    const b=req.body||{}, question=String(b.question??'').trim().slice(0,5000),
      a=clean(b.option_a,1000), bb=clean(b.option_b,1000), c=clean(b.option_c,1000), d=clean(b.option_d,1000),
      correct=clean(b.correct_option,1).toUpperCase(), explanation=String(b.explanation??'').trim().slice(0,5000),
      year=clean(b.academic_year,30), subject=clean(b.subject,100), published=b.published!==false;
    if(!question||!a||!bb||!c||!d||!year||!subject||!['A','B','C','D'].includes(correct)) return res.status(400).json({error:'Question, all four options, correct answer, year and subject are required.'});
    try {
      const r=await pool.query(`INSERT INTO quiz_questions(question,option_a,option_b,option_c,option_d,correct_option,explanation,academic_year,subject,published)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,question,option_a,option_b,option_c,option_d,correct_option,explanation,academic_year,subject,published,created_at`,
        [question,a,bb,c,d,correct,explanation,year,subject,published]);
      await audit('QUIZ_QUESTION_CREATED','quiz_question',r.rows[0].id,{academic_year:year,subject,published});
      res.status(201).json({question:r.rows[0]});
    } catch(e) { console.error('Create quiz question:',e.message); res.status(500).json({error:'Unable to save quiz question. Check that Module 04 migration has been run.'}); }
  });
  app.patch('/api/admin/v2/quizzes/:id', adminOnly, async (req,res) => {
    const b=req.body||{}, question=String(b.question??'').trim().slice(0,5000),
      a=clean(b.option_a,1000), bb=clean(b.option_b,1000), c=clean(b.option_c,1000), d=clean(b.option_d,1000),
      correct=clean(b.correct_option,1).toUpperCase(), explanation=String(b.explanation??'').trim().slice(0,5000),
      year=clean(b.academic_year,30), subject=clean(b.subject,100), published=b.published!==false;
    if(!question||!a||!bb||!c||!d||!year||!subject||!['A','B','C','D'].includes(correct)) return res.status(400).json({error:'Question, all four options, correct answer, year and subject are required.'});
    try {
      const r=await pool.query(`UPDATE quiz_questions SET question=$1,option_a=$2,option_b=$3,option_c=$4,option_d=$5,correct_option=$6,explanation=$7,academic_year=$8,subject=$9,published=$10,updated_at=NOW() WHERE id=$11
        RETURNING id,question,option_a,option_b,option_c,option_d,correct_option,explanation,academic_year,subject,published,created_at,updated_at`,
        [question,a,bb,c,d,correct,explanation,year,subject,published,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Quiz question not found.'});
      await audit('QUIZ_QUESTION_UPDATED','quiz_question',req.params.id,{academic_year:year,subject,published});
      res.json({question:r.rows[0]});
    } catch(e) { console.error('Update quiz question:',e.message); res.status(500).json({error:'Unable to update quiz question.'}); }
  });
  app.delete('/api/admin/v2/quizzes/:id', adminOnly, async (req,res) => {
    try {
      const r=await pool.query(`DELETE FROM quiz_questions WHERE id=$1 RETURNING id`,[req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Quiz question not found.'});
      await audit('QUIZ_QUESTION_DELETED','quiz_question',req.params.id,{});
      res.json({ok:true});
    } catch(e) { console.error('Delete quiz question:',e.message); res.status(500).json({error:'Unable to delete quiz question.'}); }
  });

  // Student quiz API deliberately withholds correct_option until answer submission.
  app.get('/api/quizzes', auth('user'), async (req,res) => {
    const year=clean(req.query.year,30), subject=clean(req.query.subject,100);
    if(!year)return res.status(400).json({error:'Select an academic year to start the quiz.'});
    try {
      const r=await pool.query(`SELECT id,question,option_a,option_b,option_c,option_d,academic_year,subject
        FROM quiz_questions WHERE published=true AND academic_year=$1 AND ($2='' OR subject=$2)
        ORDER BY created_at ASC,id ASC`,[year,subject]);
      res.json({questions:r.rows});
    } catch(e) { console.error('Student quiz:',e.message); res.status(500).json({error:'Unable to load quiz questions. Please try again.'}); }
  });
  app.post('/api/quizzes/:id/answer', auth('user'), async (req,res) => {
    const selected=clean(req.body?.selected_option,1).toUpperCase();
    if(!['A','B','C','D'].includes(selected))return res.status(400).json({error:'Choose one of the four options.'});
    try {
      const r=await pool.query(`SELECT correct_option,explanation,option_a,option_b,option_c,option_d FROM quiz_questions WHERE id=$1 AND published=true`,[req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'This question is no longer available.'});
      const q=r.rows[0], labels={A:q.option_a,B:q.option_b,C:q.option_c,D:q.option_d};
      res.json({correct:selected===q.correct_option,selected_option:selected,correct_option:q.correct_option,correct_answer:labels[q.correct_option],explanation:q.explanation||''});
    } catch(e) { console.error('Quiz answer:',e.message); res.status(500).json({error:'Unable to check this answer.'}); }
  });


  // Sell on Cuspilo: owner review queue for student-submitted resale listings.
  app.get('/api/admin/v2/seller-listings', adminOnly, async (req,res) => {
    try {
      const status=clean(req.query.status||'PENDING',20);
      const r=await pool.query(`SELECT l.*,u.name AS seller_name,u.email AS seller_email,u.phone AS seller_phone
        FROM seller_listings l JOIN users u ON u.id=l.seller_user_id
        WHERE ($1='' OR l.status=$1) ORDER BY l.created_at DESC`,[status]);
      res.json({listings:r.rows});
    } catch(e){console.error('Seller listing queue:',e.message);res.status(500).json({error:'Unable to load seller listings.'});}
  });
  app.patch('/api/admin/v2/seller-listings/:id', adminOnly, async (req,res) => {
    const action=clean(req.body?.action,20), note=clean(req.body?.admin_note,1000);
    if(!['approve','reject','edit'].includes(action))return res.status(400).json({error:'Choose approve, reject or edit.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const found=await client.query(`SELECT * FROM seller_listings WHERE id=$1 FOR UPDATE`,[req.params.id]);
      if(!found.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Seller listing not found.'});}
      const l=found.rows[0];
      if(l.status!=='PENDING' && action!=='edit'){await client.query('ROLLBACK');return res.status(409).json({error:'Only pending listings can be approved or rejected.'});}
      if(action==='reject'){
        await client.query(`UPDATE seller_listings SET status='REJECTED',admin_note=$1,updated_at=NOW() WHERE id=$2`,[note,l.id]);
      } else if(action==='edit'){
        const b=req.body||{}, name=clean(b.product_name||l.product_name,160), desc=clean(b.description??l.description,3000), price=Number(b.asking_price??l.asking_price);
        if(!name||!Number.isFinite(price)||price<=0){await client.query('ROLLBACK');return res.status(400).json({error:'Valid product name and price are required.'});}
        await client.query(`UPDATE seller_listings SET product_name=$1,description=$2,asking_price=$3,admin_note=$4,updated_at=NOW() WHERE id=$5`,[name,desc,price,note,l.id]);
      } else {
        const p=await client.query(`INSERT INTO admin_products(name,sku,subject,price,description,image_data,category,academic_year,product_type,multi_images,store_group,search_keywords,stock_quantity,quality_note)
          VALUES($1,NULL,$2,$3,$4,$5,'User Resale',$6,'Dental Store',CASE WHEN $5<>'' THEN jsonb_build_array($5) ELSE '[]'::jsonb END,'DENTAL_STORE',$7,1,$8) RETURNING id`,
          [l.product_name,l.subject,l.asking_price,l.description,l.image_data,l.academic_year,`sold by user ${l.product_name}`,`Sold by user · Used ${l.years_used} year(s)`]);
        await client.query(`UPDATE seller_listings SET status='APPROVED',approved_product_id=$1,admin_note=$2,updated_at=NOW() WHERE id=$3`,[p.rows[0].id,note,l.id]);
        await client.query(`UPDATE admin_products SET seller_listing_id=$1 WHERE id=$2`,[l.id,p.rows[0].id]);
      }
      await client.query(`INSERT INTO admin_audit_log(action,entity_type,entity_id,details) VALUES($1,'seller_listing',$2,$3::jsonb)`,
        [`SELLER_LISTING_${action.toUpperCase()}`,String(l.id),JSON.stringify({note})]);
      await client.query('COMMIT');res.json({ok:true});
    }catch(e){try{await client.query('ROLLBACK')}catch{}console.error('Seller listing review:',e.message);res.status(500).json({error:'Unable to update seller listing.'});}
    finally{client.release();}
  });

};
