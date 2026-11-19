
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TOKEN_KEY='cuspylo_admin_token';
  const USER_KEY='cuspylo_admin_user';
  let token=sessionStorage.getItem(TOKEN_KEY)||'';
  let options={colleges:[],years:[],subjects:[]};
  const app=$('#admin-app');

  const api=async(path,method='GET',body)=>{
    const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(d.error||'Request failed');
    return d;
  };

  const msg=s=>{const el=$('#msg');if(el)el.textContent=s;};

  // Display-only serial numbers for admin tables.
  function applyAdminSerialNumbers(root){
    root.querySelectorAll('.am-table table').forEach(table=>{
      const header=table.tHead?.rows?.[0];
      if(!header)return;

      if(!header.querySelector('[data-am-sno-head]')){
        const th=document.createElement('th');
        th.className='am-sno';
        th.dataset.amSnoHead='';
        th.scope='col';
        th.textContent='S.No.';
        header.insertBefore(th,header.firstChild);
      }

      let serial=0;
      [...table.tBodies].forEach(body=>{
        [...body.rows].forEach(row=>{
          const emptyCell=row.cells.length===1 && row.cells[0].hasAttribute('colspan');

          if(emptyCell){
            if(!row.dataset.amSnoEmpty){
              row.cells[0].colSpan=Number(row.cells[0].colSpan||1)+1;
              row.dataset.amSnoEmpty='1';
            }
            return;
          }

          let cell=row.querySelector(':scope > td[data-am-sno]');

          if(!cell){
            cell=document.createElement('td');
            cell.className='am-sno';
            cell.dataset.amSno='';
            row.insertBefore(cell,row.firstChild);
          }

          if(row.hidden){
            if(cell.textContent!=='')cell.textContent='';
            return;
          }

          serial+=1;
          const nextValue=String(serial);
          if(cell.textContent!==nextValue)cell.textContent=nextValue;
        });
      });
    });
  }

  const qs=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!=='')).toString();

  const fileData=file=>new Promise((resolve,reject)=>{
    if(!file)return resolve('');
    if(file.size>1_800_000)return reject(Error('Choose an image smaller than 1.8 MB.'));
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=()=>reject(Error('Could not read image.'));
    r.readAsDataURL(file);
  });

  const pdfFileData=file=>new Promise((resolve,reject)=>{
    if(!file)return resolve(null);
    if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))return reject(Error('Upload a PDF file.'));
    if(file.size>15*1024*1024)return reject(Error('PDF must be 15 MB or smaller.'));
    const r=new FileReader();
    r.onload=()=>resolve({data:r.result,filename:file.name});
    r.onerror=()=>reject(Error('Could not read PDF.'));
    r.readAsDataURL(file);
  });

  function logout(){
    token='';
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    login();
  }

  function login(){
    app.innerHTML=`<section class="am-card am-login">
      <button type="button" id="student-portal-login" class="am-quiet" style="margin-bottom:16px">← Back to Student Portal</button>
      <img src="/logo.png" alt="CUSPYLO" style="width:150px;display:block;margin:0 auto 12px">
      <h1>CUSPYLO Owner Login</h1>
      <p>Restricted administration access.</p>
      <form id="admin-login">
        <input name="id" placeholder="Admin ID" autocomplete="username" required>
        <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
        <button>Sign in</button>
      </form>
      <p id="login-error" role="alert"></p>
    </section>`;

    $('#student-portal-login').onclick=()=>{window.location.href='/';};

    $('#admin-login').onsubmit=async e=>{
      e.preventDefault();
      const b=e.target.querySelector('button');
      b.disabled=true;
      b.textContent='Signing in…';

      try{
        const r=await fetch('/api/admin/login',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(Object.fromEntries(new FormData(e.target)))
        });
        const d=await r.json();
        if(!r.ok)throw Error(d.error||'Login failed');

        token=d.token;
        sessionStorage.setItem(TOKEN_KEY,token);
        sessionStorage.setItem(USER_KEY,JSON.stringify(d.user||{}));
        ownerWelcome();
      }catch(x){
        $('#login-error').textContent=x.message;
        b.disabled=false;
        b.textContent='Sign in';
      }
    };
  }

  function ownerWelcome(){
    app.innerHTML=`<section class="am-owner am-card">
      <button type="button" id="student-portal-owner" class="am-quiet" style="margin-bottom:16px">← Back to Student Portal</button>
      <img src="/logo.png" alt="CUSPYLO" style="width:170px">
      <p class="am-eyebrow">OWNER WORKSPACE</p>
      <h1>Hello Owner!</h1>
      <p>Click below to view performance and manage product additions.</p>
      <button id="open-dashboard" class="am-primary">Open Admin Control Centre →</button>
      <div><button id="owner-logout" class="am-quiet">Logout</button></div>
    </section>`;

    $('#student-portal-owner').onclick=()=>{window.location.href='/';};
    $('#open-dashboard').onclick=start;
    $('#owner-logout').onclick=logout;
  }

  async function start(){
    try{
      const [summary,opts]=await Promise.all([
        api('/admin/v2/summary'),
        api('/admin/v2/filter-options')
      ]);
      options=opts;
      renderShell(summary);
      await show('orders');
    }catch(e){
      app.innerHTML=`<section class="am-card">
        <h2>Admin access required</h2>
        <p>${esc(e.message)}</p>
        <button id="relogin">Return to admin login</button>
      </section>`;
      $('#relogin').onclick=logout;
    }
  }

  function renderShell(s){
    app.innerHTML=`<header class="am-head">
      <div>
        <p class="am-eyebrow">CUSPYLO · OWNER WORKSPACE</p>
        <h1>Admin Control Centre</h1>
        <p>Students, products, orders and business performance</p>
      </div>
      <div class="am-head-actions">
        <button id="student-portal-dashboard" class="am-quiet">← Student Portal</button>
        <button id="owner-back" class="am-quiet">← Back to Owner</button>
        <button id="refresh">Refresh</button>
        <button id="admin-logout" class="am-danger">Logout</button>
      </div>
    </header>

    <section class="am-stats">
      <article><small>Total students</small><b>${s.users.total_users}</b></article>
      <article><small>Active</small><b>${s.users.active_users}</b></article>
      <article><small>Suspended</small><b>${s.users.suspended_users}</b></article>
      <article><small>Deleted</small><b>${s.users.deleted_users}</b></article>
      <article><small>Orders</small><b>${s.orders.total}</b></article>
      <article><small>Order value</small><b>₹${Number(s.orders.revenue||0).toLocaleString('en-IN')}</b></article>
      <article><small>Active products</small><b>${s.products.active_products||0}</b></article>
    </section>

    <nav class="am-tabs">
      <button data-tab="orders">Orders</button>
      <button data-tab="users">Students</button>
      <button data-tab="products">Products</button>
      <button data-tab="homepage-posts">New Post</button>
      <button data-tab="seller-listings">Sell on Cuspylo</button>
      <button data-tab="quizzes">Quiz Questions</button>
      <button data-tab="create-kit">Create Kit</button>
      <button data-tab="faqs">FAQs</button>
      <button data-tab="opportunities">Join Us</button>
      <button data-tab="reviews">Product reviews</button>
      <button data-tab="private-feedback">Private feedback</button>
      <button data-tab="audit">Audit log</button>
    </nav>

    <div id="am-content"></div>
    <p id="msg" role="status"></p>`;

    app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab));
    $('#refresh').onclick=start;
    $('#student-portal-dashboard').onclick=()=>{window.location.href='/';};
    $('#owner-back').onclick=ownerWelcome;
    $('#admin-logout').onclick=logout;

    const adminContent=$('#am-content');

    if(adminContent && !adminContent.dataset.serialObserver){
      const serialObserver=new MutationObserver(()=>applyAdminSerialNumbers(adminContent));
      serialObserver.observe(adminContent,{
        childList:true,
        subtree:true,
        attributes:true,
        attributeFilter:['hidden']
      });
      adminContent.dataset.serialObserver='1';
      applyAdminSerialNumbers(adminContent);
    }
  }

  const opt=(arr,placeholder)=>`<option value="">${placeholder}</option>`+
    arr.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');

  // -------------------------------------------------------
  // KIT MANAGEMENT
  // -------------------------------------------------------

  const kitTypes=[
    ['PREMIUM','Premium Kit'],
    ['HIGH_PERFORMANCE','High-Performance Kit'],
    ['BALANCED','Balanced Kit'],
    ['ECONOMY','Economy Kit'],
    ['CUSTOMIZABLE','Customizable Kit']
  ];

  function kitManagementHTML(kits){
    return `<div class="am-table">
      <table>
        <thead>
          <tr>
            <th>Kit</th>
            <th>Type / year / subject</th>
            <th>Included products</th>
            <th>Calculated price</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${(kits||[]).map(k=>`<tr data-kit-row="${k.id}">
            <td><b>${esc(k.name)}</b><br>${esc(k.description||'')}</td>
            <td>${esc(k.kit_type)}<br>${esc(k.academic_year)} / ${esc(k.subject||'Universal')}</td>
            <td>${(k.items||[]).map(i=>`${esc(i.name)} × ${i.quantity}`).join('<br>')}</td>
            <td>₹${Number(k.total_price||0).toFixed(2)}</td>
            <td><span class="am-status">${k.active===false?'Hidden':'Published'}</span></td>
            <td>
              <button type="button" data-kit-edit="${k.id}">Edit</button>
              <button type="button" data-kit-toggle="${k.id}">${k.active===false?'Publish':'Hide'}</button>
              <button type="button" class="am-danger" data-kit-delete="${k.id}">Delete</button>
            </td>
          </tr>`).join('')||'<tr><td colspan="6">No kits created yet.</td></tr>'}
        </tbody>
      </table>
    </div>`;
  }

  function bindKitManagement(root,kits,products,subjects,reload){
    if(!root)return;

    root.querySelectorAll('[data-kit-edit]').forEach(button=>{
      button.onclick=()=>{
        const kit=kits.find(k=>String(k.id)===button.dataset.kitEdit);
        if(!kit)return;

        root.querySelector('[data-kit-editor-row]')?.remove();

        const selected=new Map(
          (kit.items||[]).map(item=>[
            String(item.product_id),
            Number(item.quantity||1)
          ])
        );

        const yearOptions=['1st Year','2nd Year','3rd Year','4th Year','Universal'];

        const subjectOptions=subjects
          .filter(s=>s.active && s.academic_year===kit.academic_year)
          .map(s=>`<option value="${esc(s.subject_name)}" ${s.subject_name===kit.subject?'selected':''}>${esc(s.subject_name)}</option>`)
          .join('');

        const productRows=products.map(p=>{
          const qty=selected.get(String(p.id))||1;
          const checked=selected.has(String(p.id));

          return `<label class="kit-pick-row">
            <input type="checkbox" data-edit-kit-product="${p.id}" ${checked?'checked':''}>
            <span>
              <b>${esc(p.name)}</b>
              <small>${esc(p.category||'General')} · ₹${Number(p.price).toFixed(2)}${p.active?'':' · Hidden product'}</small>
            </span>
            <input type="number" min="1" max="99" value="${qty}" data-edit-kit-qty="${p.id}" aria-label="Quantity">
          </label>`;
        }).join('');

        const editorRow=document.createElement('tr');
        editorRow.dataset.kitEditorRow='';

        editorRow.innerHTML=`<td colspan="6">
          <form data-kit-editor class="am-product-card">
            <h3>Edit kit: ${esc(kit.name)}</h3>

            <div class="am-product-grid">
              <label>Kit name
                <input name="name" maxlength="160" required value="${esc(kit.name)}">
              </label>

              <label>Kit type
                <select name="kit_type">
                  ${kitTypes.map(([value,label])=>`<option value="${value}" ${kit.kit_type===value?'selected':''}>${label}</option>`).join('')}
                </select>
              </label>

              <label>Academic year
                <select name="academic_year" data-edit-kit-year>
                  ${yearOptions.map(y=>`<option ${kit.academic_year===y?'selected':''}>${y}</option>`).join('')}
                </select>
              </label>

              <label>Subject
                <select name="subject" data-edit-kit-subject>
                  <option value="Universal">Universal</option>
                  ${subjectOptions}
                </select>
              </label>
            </div>

            <label>Description
              <textarea name="description" rows="2">${esc(kit.description||'')}</textarea>
            </label>

            <label>Economy kit specification disclosure
              <textarea name="quality_disclosure" rows="2">${esc(kit.quality_disclosure||'')}</textarea>
            </label>

            <h4>Kit products and quantities</h4>
            <div class="am-kit-picker">${productRows||'<p>No catalogue products available.</p>'}</div>

            <p data-edit-kit-total class="am-kit-total">Selected kit total: ₹0.00</p>

            <button class="am-primary" type="submit">Save Kit Changes</button>
            <button type="button" class="am-quiet" data-kit-cancel>Cancel</button>
          </form>
        </td>`;

        button.closest('tr').after(editorRow);

        const form=editorRow.querySelector('[data-kit-editor]');
        const year=form.querySelector('[data-edit-kit-year]');
        const subject=form.querySelector('[data-edit-kit-subject]');
        const total=form.querySelector('[data-edit-kit-total]');

        const updateSubjects=()=>{
          const current=subject.value;
          const available=subjects.filter(s=>s.active && s.academic_year===year.value);

          subject.innerHTML='<option value="Universal">Universal</option>'+
            available.map(s=>`<option value="${esc(s.subject_name)}">${esc(s.subject_name)}</option>`).join('');

          subject.value=available.some(s=>s.subject_name===current)?current:'Universal';
        };

        year.onchange=updateSubjects;

        const calculate=()=>{
          let sum=0;

          form.querySelectorAll('[data-edit-kit-product]:checked').forEach(check=>{
            const product=products.find(p=>String(p.id)===check.dataset.editKitProduct);
            const qtyInput=form.querySelector(`[data-edit-kit-qty="${check.dataset.editKitProduct}"]`);
            const quantity=Math.max(1,Math.min(99,Number(qtyInput?.value||1)));

            if(product)sum+=Number(product.price)*quantity;
          });

          total.textContent=`Selected kit total: ₹${sum.toFixed(2)}`;
        };

        form.onchange=calculate;
        form.oninput=calculate;
        calculate();

        form.querySelector('[data-kit-cancel]').onclick=()=>editorRow.remove();

        form.onsubmit=async event=>{
          event.preventDefault();

          const items=[...form.querySelectorAll('[data-edit-kit-product]:checked')].map(check=>{
            const id=check.dataset.editKitProduct;
            const qtyInput=form.querySelector(`[data-edit-kit-qty="${id}"]`);

            return {
              product_id:Number(id),
              quantity:Math.max(1,Math.min(99,Number(qtyInput?.value||1)))
            };
          });

          if(!items.length){
            msg('Select at least one product for this kit.');
            return;
          }

          const body=Object.fromEntries(new FormData(form));
          body.items=items;

          const saveButton=form.querySelector('[type="submit"]');
          saveButton.disabled=true;
          saveButton.textContent='Saving…';

          try{
            await api('/admin/v2/kits/'+kit.id,'PATCH',body);
            msg('Kit updated successfully.');
            await reload();
          }catch(error){
            msg(error.message);
            saveButton.disabled=false;
            saveButton.textContent='Save Kit Changes';
          }
        };

        editorRow.scrollIntoView({behavior:'smooth',block:'center'});
      };
    });

    root.querySelectorAll('[data-kit-toggle]').forEach(button=>{
      button.onclick=async()=>{
        const kit=kits.find(k=>String(k.id)===button.dataset.kitToggle);
        if(!kit)return;

        const active=kit.active===false;
        const action=active?'publish':'hide';

        if(!confirm(`${action==='hide'?'Hide':'Publish'} "${kit.name}"?`))return;

        try{
          await api('/admin/v2/kits/'+kit.id+'/status','PATCH',{active});
          msg(`Kit ${active?'published':'hidden'} successfully.`);
          await reload();
        }catch(error){
          msg(error.message);
        }
      };
    });

    root.querySelectorAll('[data-kit-delete]').forEach(button=>{
      button.onclick=async()=>{
        const kit=kits.find(k=>String(k.id)===button.dataset.kitDelete);
        if(!kit)return;

        if(!confirm(`Permanently delete "${kit.name}"? This cannot be undone. If it is referenced elsewhere, hide it instead.`))return;

        try{
          await api('/admin/v2/kits/'+kit.id,'DELETE');
          msg('Kit deleted successfully.');
          await reload();
        }catch(error){
          msg(error.message);
        }
      };
    });
  }

  // -------------------------------------------------------
  // HOMEPAGE PROMOTIONS
  // -------------------------------------------------------

  async function loadHomepagePosts(){
    const c=$('#am-content');

    c.innerHTML=`<h2>Homepage promotions · New Post</h2>
      <p class="am-muted">Upload exactly three wide promotional images. Their destinations are fixed: Dental Store, Notes and Mind Maps.</p>
      <form id="homepage-post-form" class="am-home-posts">
        ${[['Dental Store','store'],['Notes','notes'],['Mind Maps','mindmaps']].map(([title,dest],i)=>`<section class="am-card am-home-post-card">
          <h3>Image ${i+1} · ${title}</h3>
          <label>Banner image <input type="file" accept="image/png,image/jpeg,image/webp" id="home-post-file-${i+1}" required></label>
          <label>Optional title <input type="text" id="home-post-title-${i+1}" maxlength="120" placeholder="${title}"></label>
          <img id="home-post-preview-${i+1}" class="am-home-post-preview" alt="${title} preview" hidden>
          <p class="am-muted">Click destination: <strong>${title}</strong></p>
        </section>`).join('')}
        <button class="am-primary" type="submit" id="publish-home-posts">Publish all 3 banners</button>
      </form>
      <p class="am-muted">Use landscape banners, ideally 16:5 ratio. Each image must be under 1.8 MB. Publishing replaces the previous three banners.</p>`;

    const files=[1,2,3].map(i=>$('#home-post-file-'+i));

    files.forEach((input,i)=>input.onchange=async()=>{
      const file=input.files?.[0];
      const preview=$('#home-post-preview-'+(i+1));

      if(!file){preview.hidden=true;return;}

      try{
        const data=await fileData(file);
        preview.src=data;
        preview.hidden=false;
      }catch(e){
        input.value='';
        msg(e.message);
      }
    });

    $('#homepage-post-form').onsubmit=async e=>{
      e.preventDefault();

      const button=$('#publish-home-posts');
      button.disabled=true;
      button.textContent='Publishing…';

      try{
        const slides=[];

        for(let i=0;i<3;i++){
          const file=files[i].files?.[0];
          if(!file)throw Error(`Please upload image ${i+1}.`);
          slides.push({
            title:$('#home-post-title-'+(i+1)).value,
            image_data:await fileData(file)
          });
        }

        const result=await api('/admin/v2/homepage-posts','PUT',{slides});
        msg(result.message||'Homepage promotions published.');
        await loadHomepagePosts();
      }catch(err){
        msg(err.message);
        button.disabled=false;
        button.textContent='Publish all 3 banners';
      }
    };

    try{
      const d=await api('/admin/v2/homepage-posts');

      (d.slides||[]).forEach(s=>{
        const i=Number(s.position);
        if(i<1||i>3)return;

        $('#home-post-title-'+i).value=s.title||'';
        const p=$('#home-post-preview-'+i);
        p.src=s.image_data;
        p.hidden=false;
      });
    }catch(e){
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // TAB ROUTING
  // -------------------------------------------------------

  async function show(tab){
    const c=$('#am-content');

    app.querySelectorAll('[data-tab]').forEach(b=>
      b.classList.toggle('active',b.dataset.tab===tab)
    );

    if(tab==='users'){
      c.innerHTML=`<h2>Student management</h2>
        <div class="am-filters">
          <input id="uq" placeholder="Search name, email, phone">
          <select id="uc">${opt(options.colleges,'All colleges')}</select>
          <select id="uy">${opt(options.years,'All academic years')}</select>
          <select id="us">${opt(['active','suspended','deleted'],'All statuses')}</select>
          <button id="uf">Apply filters</button>
        </div>
        <div id="user-table" class="am-table">Loading…</div>`;
      $('#uf').onclick=loadUsers;
      await loadUsers();
    }

    if(tab==='orders'){
      c.innerHTML=`<h2>Order management & tracking</h2>
        <div class="am-filters">
          <input id="oq" placeholder="Invoice, customer or phone">
          <select id="oc">${opt(options.colleges,'All colleges')}</select>
          <select id="oy">${opt(options.years,'All years')}</select>
          <select id="osub">${opt([...options.subjects,'Unassigned'],'All subjects')}</select>
          <select id="ost">${opt(['Received','Packed','Out for Delivery','Completed','Cancelled'],'All statuses')}</select>
          <label>From <input id="of" type="date"></label>
          <label>To <input id="ot" type="date"></label>
          <button id="ofilter">Apply filters</button>
        </div>
        <div id="order-table" class="am-table">Loading…</div>`;
      $('#ofilter').onclick=loadOrders;
      await loadOrders();
    }

    if(tab==='products')await loadProducts();
    if(tab==='homepage-posts')await loadHomepagePosts();
    if(tab==='seller-listings')await loadSellerListings();
    if(tab==='quizzes')await loadQuizzes();
    if(tab==='create-kit')await loadKitBuilder();
    if(tab==='faqs')await loadFaqs();
    if(tab==='opportunities')await loadOpportunities();
    if(tab==='reviews')await loadReviews();
    if(tab==='private-feedback')await loadPrivateFeedback();

    if(tab==='audit'){
      const d=await api('/admin/v2/audit');

      c.innerHTML=`<h2>Audit log</h2>
        <div class="am-table">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>
              ${d.events.map(x=>`<tr>
                <td>${new Date(x.created_at).toLocaleString('en-IN')}</td>
                <td>${esc(x.action)}</td>
                <td>${esc(x.entity_type)} #${esc(x.entity_id)}</td>
                <td><code>${esc(JSON.stringify(x.details))}</code></td>
              </tr>`).join('')||'<tr><td colspan="4">No events yet.</td></tr>'}
            </tbody>
          </table>
        </div>`;
    }
  }

  // -------------------------------------------------------
  // STUDENT MANAGEMENT
  // -------------------------------------------------------

  async function loadUsers(){
    try{
      const d=await api('/admin/v2/users?'+qs({
        q:$('#uq').value,
        college:$('#uc').value,
        year:$('#uy').value,
        status:$('#us').value
      }));

      $('#user-table').innerHTML=`<table>
        <thead><tr><th>Student</th><th>Contact</th><th>College</th><th>Year</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${d.users.map(u=>`<tr>
            <td>${esc(u.name)}</td>
            <td>${esc(u.email||'—')}<br>${esc(u.phone||'—')}</td>
            <td>${esc(u.college||'—')}</td>
            <td>${esc(u.academic_year||'—')}</td>
            <td>${u.created_at?new Date(u.created_at).toLocaleDateString('en-IN'):'—'}</td>
            <td><span class="am-status ${esc(u.account_status)}">${esc(u.account_status)}</span></td>
            <td>
              ${u.account_status==='active'?`<button data-suspend="${u.id}">Suspend</button>`:''}
              ${u.account_status==='suspended'?`<button data-restore="${u.id}">Restore</button>`:''}
              ${u.account_status!=='deleted'?`<button class="am-danger" data-delete="${u.id}">Delete</button>`:''}
            </td>
          </tr>`).join('')||'<tr><td colspan="7">No students match.</td></tr>'}
        </tbody>
      </table>`;

      $('#user-table').querySelectorAll('[data-suspend]').forEach(b=>
        b.onclick=()=>changeStatus(b.dataset.suspend,'suspended')
      );

      $('#user-table').querySelectorAll('[data-restore]').forEach(b=>
        b.onclick=()=>changeStatus(b.dataset.restore,'active')
      );

      $('#user-table').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
        const u=d.users.find(x=>String(x.id)===b.dataset.delete);

        if(!confirm(`Permanently deactivate ${u.name}? Personal details will be anonymized; invoices and order history retained.`))return;

        try{
          const r=await api('/admin/v2/users/'+u.id,'DELETE');
          msg(`Deleted. ${r.ordersAnonymized} historic orders anonymized.`);
          await loadUsers();
        }catch(e){
          msg(e.message);
        }
      });
    }catch(e){
      msg(e.message);
    }
  }

  async function changeStatus(id,status){
    try{
      await api('/admin/v2/users/'+id+'/status','PATCH',{status});
      msg('Account status updated. Existing sessions are now blocked.');
      await loadUsers();
    }catch(e){
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // INVOICE DOWNLOAD
  // -------------------------------------------------------

  async function downloadAdminInvoice(button){
    const invoice=button.dataset.invoice;
    const original=button.textContent;

    button.disabled=true;
    button.textContent='Preparing PDF…';

    try{
      const response=await fetch('/api/admin/v2/orders/'+encodeURIComponent(invoice)+'/invoice.pdf',{
        method:'GET',
        headers:{Authorization:'Bearer '+token}
      });

      if(!response.ok){
        const error=await response.json().catch(()=>({}));
        throw Error(error.error||`Invoice download failed (${response.status}).`);
      }

      const blob=await response.blob();
      if(!blob.size||blob.type!=='application/pdf')throw Error('The server did not return a valid PDF invoice.');

      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=(invoice||'CUSPYLO-invoice')+'.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(()=>URL.revokeObjectURL(url),1500);
      msg('Invoice downloaded: '+invoice+'.pdf');
    }catch(error){
      msg(error.message||'Unable to download invoice.');
    }finally{
      button.disabled=false;
      button.textContent=original;
    }
  }

  // -------------------------------------------------------
  // ORDER MANAGEMENT
  // -------------------------------------------------------

  async function loadOrders(){
    try{
      const d=await api('/admin/v2/orders?'+qs({
        q:$('#oq').value,
        college:$('#oc').value,
        year:$('#oy').value,
        subject:$('#osub').value,
        status:$('#ost').value,
        from:$('#of').value,
        to:$('#ot').value
      }));

      const steps=['Received','Packed','Out for Delivery','Delivered'];

      $('#order-table').innerHTML=`<table>
        <thead><tr><th>Invoice / Customer</th><th>College / year</th><th>Items</th><th>Amount</th><th>Progress</th><th>Next action</th><th>Invoice</th><th>Account</th></tr></thead>
        <tbody>
          ${d.orders.map(o=>{
            const history=o.tracking||[{status:'Received'}];
            const current=o.status==='Completed'?3:Math.max(0,steps.indexOf(o.status));

            return `<tr>
              <td><b>${esc(o.invoice)}</b><br>${esc(o.customerDeleted?'Deleted user':o.name)}<br>${esc(o.customerDeleted?'':o.phone||'')}</td>
              <td>${esc(o.college||'—')}<br>${esc(o.academicYear||'—')}</td>
              <td>${esc((o.lineItems||[]).map(i=>`${i.item_name} × ${i.quantity}`).join(', ')||'—')}</td>
              <td>₹${esc(o.total)}</td>
              <td>
                <div class="am-timeline">
                  ${steps.map((st,i)=>`<span class="${i<=current?'done':''}">${i<=current?'✓':'○'} ${st}</span>`).join('')}
                </div>
                <small>${esc(o.status)}</small>
              </td>
              <td>
                ${o.status!=='Completed'&&o.status!=='Cancelled'?`<button data-advance="${esc(o.invoice)}" data-next="${steps[Math.min(current+1,3)]}">${current===3?'Complete':'Mark '+steps[Math.min(current+1,3)]}</button>`:''}
                ${history.length>1?`<button class="am-quiet" data-undo="${esc(o.invoice)}">Undo</button>`:''}
              </td>
              <td><button data-invoice="${esc(o.invoice)}">Download invoice</button></td>
              <td>${o.customerDeleted?'<span class="am-deleted">✕ User deleted</span>':'<span class="am-existing">✓ Existing user</span>'}</td>
            </tr>`;
          }).join('')||'<tr><td colspan="8">No orders match.</td></tr>'}
        </tbody>
      </table>`;

      $('#order-table').querySelectorAll('[data-advance]').forEach(b=>b.onclick=async()=>{
        try{
          await api('/admin/v2/orders/'+encodeURIComponent(b.dataset.advance)+'/status','PATCH',{status:b.dataset.next});
          msg('Order tracking updated.');
          await loadOrders();
        }catch(e){
          msg(e.message);
        }
      });

      $('#order-table').querySelectorAll('[data-undo]').forEach(b=>b.onclick=async()=>{
        if(!confirm('Undo the latest order tracking step?'))return;

        try{
          await api('/admin/v2/orders/'+encodeURIComponent(b.dataset.undo)+'/undo','PATCH',{});
          msg('Latest tracking step undone.');
          await loadOrders();
        }catch(e){
          msg(e.message);
        }
      });

      $('#order-table').querySelectorAll('[data-invoice]').forEach(b=>
        b.onclick=()=>downloadAdminInvoice(b)
      );
    }catch(e){
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // CREATE KIT
  // -------------------------------------------------------

  async function loadKitBuilder(){
    const c=$('#am-content');

    try{
      const [pd,sd,kd]=await Promise.all([
        api('/admin/v2/products'),
        api('/admin/v2/subjects'),
        api('/admin/v2/kits')
      ]);

      const products=(pd.products||[]).filter(p=>p.active&&p.product_type==='Dental Store');
      const subjects=sd.subjects||[];
      const years=['1st Year','2nd Year','3rd Year','4th Year','Universal'];

      const opts=y=>subjects
        .filter(x=>x.academic_year===y&&x.active)
        .map(x=>`<option>${esc(x.subject_name)}</option>`)
        .join('');

      c.innerHTML=`<h2>Create Kit</h2>
        <p class="am-note">Choose products already in your catalogue. Search or filter the list, select products and set quantities. Kit price is calculated automatically.</p>

        <form id="kit-form" class="am-product-card">
          <div class="am-product-grid">
            <label>Kit name<input name="name" required maxlength="160" placeholder="e.g. 2nd Year Complete Kit"></label>

            <label>Kit type
              <select name="kit_type">
                <option value="PREMIUM">Premium Kit</option>
                <option value="HIGH_PERFORMANCE">High-Performance Kit</option>
                <option value="BALANCED">Balanced Kit</option>
                <option value="ECONOMY">Economy Kit</option>
                <option value="CUSTOMIZABLE">Customizable Kit</option>
              </select>
            </label>

            <label>Academic year
              <select name="academic_year" id="kit-year">
                ${years.map(x=>`<option>${x}</option>`).join('')}
              </select>
            </label>

            <label>Subject (optional)
              <select name="subject" id="kit-subject">
                <option>Universal</option>
                ${opts('1st Year')}
              </select>
            </label>
          </div>

          <label>Description<textarea name="description" rows="2" placeholder="What is included and who this kit is for"></textarea></label>
          <label>Economy kit specification disclosure<textarea name="quality_disclosure" rows="2" placeholder="Required for Economy Kit: explain lower-grade specifications"></textarea></label>

          <div class="am-kit-instructions">Search the catalogue, tick the products you want, then set each quantity. Selected products are included in this kit.</div>

          <div class="am-kit-tools">
            <input id="kit-search" type="search" placeholder="Search product name, SKU, category or subject">
            <select id="kit-category">
              <option value="">All categories</option>
              <option value="DENTAL_STORE">Dental</option>
              <option value="OTHER_ESSENTIALS">Others</option>
            </select>
          </div>

          <div id="kit-product-picker" class="am-kit-picker">
            ${products.map(x=>`<label class="kit-pick-row" data-kit-row data-category="${esc(x.store_group||'DENTAL_STORE')}">
              <input type="checkbox" data-kit-product="${x.id}">
              <span>
                <b>${esc(x.name)}</b>
                <small>${esc(x.category||'General')} · ${esc(x.subject||'Universal')} · ${esc(x.academic_year||'Universal')} · ₹${Number(x.price).toFixed(2)}</small>
              </span>
              <input aria-label="Quantity for ${esc(x.name)}" type="number" min="1" max="99" value="1" data-kit-qty="${x.id}">
            </label>`).join('')||'<p class="am-note">No active Dental Store products yet. Add products first, then return here.</p>'}
          </div>

          <p id="kit-total" class="am-kit-total">Selected kit total: ₹0.00</p>
          <button class="am-primary" type="submit">Create and Save Kit</button>
        </form>

        <h3>Existing Kits</h3>
        <div id="kit-management">${kitManagementHTML(kd.kits||[])}</div>`;

      const form=$('#kit-form');
      const picker=$('#kit-product-picker');
      const search=$('#kit-search');
      const category=$('#kit-category');
      const total=$('#kit-total');
      const year=$('#kit-year');
      const subject=$('#kit-subject');

      bindKitManagement(
        $('#kit-management'),
        kd.kits||[],
        products,
        subjects,
        loadKitBuilder
      );

      const updateSubject=()=>{
        subject.innerHTML='<option>Universal</option>'+opts(year.value);
      };

      year.onchange=updateSubject;

      const filter=()=>{
        const term=search.value.trim().toLowerCase();

        picker.querySelectorAll('[data-kit-row]').forEach(row=>{
          row.hidden=!(
            row.textContent.toLowerCase().includes(term)&&
            (!category.value||row.dataset.category===category.value)
          );
        });
      };

      search.oninput=filter;
      category.onchange=filter;

      const calc=()=>{
        let sum=0;

        picker.querySelectorAll('[data-kit-product]:checked').forEach(ch=>{
          const prod=products.find(x=>String(x.id)===ch.dataset.kitProduct);
          const qty=Math.max(1,Number(
            picker.querySelector(`[data-kit-qty="${ch.dataset.kitProduct}"]`)?.value||1
          ));

          if(prod)sum+=Number(prod.price)*qty;
        });

        total.textContent=`Selected kit total: ₹${sum.toFixed(2)}`;
      };

      picker.onchange=calc;
      picker.oninput=calc;

      form.onsubmit=async e=>{
        e.preventDefault();

        const items=[...picker.querySelectorAll('[data-kit-product]:checked')].map(ch=>({
          product_id:Number(ch.dataset.kitProduct),
          quantity:Math.max(1,Math.min(99,Number(
            picker.querySelector(`[data-kit-qty="${ch.dataset.kitProduct}"]`).value||1
          )))
        }));

        const body=Object.fromEntries(new FormData(form));
        body.items=items;

        try{
          await api('/admin/v2/kits','POST',body);
          msg('Kit created successfully.');
          await loadKitBuilder();
        }catch(err){
          msg(err.message);
        }
      };
    }catch(e){
      c.innerHTML=`<section class="am-product-card">
        <h2>Unable to open Create Kit</h2>
        <p>${esc(e.message)}</p>
        <p class="am-note">Check that the database migration has been run and the admin API is deployed.</p>
      </section>`;
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // SELLER LISTINGS
  // -------------------------------------------------------

  async function loadSellerListings(){
    const c=$('#am-content');

    try{
      const d=await api('/admin/v2/seller-listings?status=PENDING');

      c.innerHTML=`<h2>Sell on Cuspylo · Review queue</h2>
        <p class="am-note">Review student listings. Approved products enter the Dental Store with a Sold by User label. Commission is recorded only after a completed sale.</p>
        <div class="am-table">
          <table>
            <thead><tr><th>Product / image</th><th>Seller</th><th>Academic details</th><th>Usage</th><th>Price</th><th>Admin review</th></tr></thead>
            <tbody>
              ${(d.listings||[]).map(x=>`<tr>
                <td>
                  ${x.image_data?`<img src="${x.image_data}" style="width:76px;height:60px;object-fit:cover;border-radius:8px">`:''}
                  <br><label>Name<input data-name="${x.id}" value="${esc(x.product_name)}"></label>
                  <label>Description<textarea data-desc="${x.id}">${esc(x.description)}</textarea></label>
                </td>
                <td>${esc(x.seller_name)}<br>${esc(x.seller_email||'')}<br>${esc(x.seller_phone||'')}</td>
                <td>${esc(x.academic_year)}<br>${esc(x.subject)}</td>
                <td>${esc(x.years_used)} year(s)</td>
                <td>₹${Number(x.asking_price).toFixed(2)}</td>
                <td>
                  <textarea data-note="${x.id}" placeholder="Admin note">${esc(x.admin_note||'')}</textarea>
                  <button data-edit-listing="${x.id}">Save edits</button>
                  <button class="am-primary" data-approve-listing="${x.id}">Approve & publish</button>
                  <button class="am-danger" data-reject-listing="${x.id}">Reject</button>
                </td>
              </tr>`).join('')||'<tr><td colspan="6">No pending seller listings.</td></tr>'}
            </tbody>
          </table>
        </div>`;

      c.querySelectorAll('[data-save-listing]').forEach(b=>b.onclick=async()=>{
        const id=b.dataset.saveListing;
        try{
          await api('/admin/v2/seller-listings/'+id,'PATCH',{
            action:'edit',
            product_name:c.querySelector(`[data-name="${id}"]`).value,
            description:c.querySelector(`[data-desc="${id}"]`).value,
            asking_price:Number(c.querySelector(`[data-price="${id}"]`).value),
            admin_note:c.querySelector(`[data-note="${id}"]`).value
          });
          msg('Listing edits saved.');
          await loadSellerListings();
        }catch(e){
          msg(e.message);
        }
      });

      c.querySelectorAll('[data-approve-listing]').forEach(b=>b.onclick=async()=>{
        if(!confirm('Approve and publish this product in the Dental Store?'))return;

        try{
          await api('/admin/v2/seller-listings/'+b.dataset.approveListing,'PATCH',{
            action:'approve',
            admin_note:c.querySelector(`[data-note="${b.dataset.approveListing}"]`).value
          });
          msg('Listing approved and published.');
          await loadSellerListings();
        }catch(e){
          msg(e.message);
        }
      });

      c.querySelectorAll('[data-reject-listing]').forEach(b=>b.onclick=async()=>{
        try{
          await api('/admin/v2/seller-listings/'+b.dataset.rejectListing,'PATCH',{
            action:'reject',
            admin_note:c.querySelector(`[data-note="${b.dataset.rejectListing}"]`).value
          });
          msg('Listing rejected.');
          await loadSellerListings();
        }catch(e){
          msg(e.message);
        }
      });

      c.querySelectorAll('[data-edit-listing]').forEach(b=>b.onclick=async()=>{
        const tr=b.closest('tr');
        const name=tr.querySelector('b').textContent;
        const desc=tr.querySelector('small').textContent;
        const price=Number(tr.querySelector('td:nth-child(5)').textContent.replace(/[₹,]/g,''));

        try{
          await api('/admin/v2/seller-listings/'+b.dataset.editListing,'PATCH',{
            action:'edit',
            product_name:name,
            description:desc,
            asking_price:price,
            admin_note:tr.querySelector(`[data-note="${b.dataset.editListing}"]`).value
          });
          msg('Listing edits saved.');
          await loadSellerListings();
        }catch(e){
          msg(e.message);
        }
      });
    }catch(e){
      c.innerHTML=`<section class="am-card"><h2>Unable to load seller listings</h2><p>${esc(e.message)}</p></section>`;
    }
  }

  // -------------------------------------------------------
  // PRODUCTS
  // -------------------------------------------------------

  async function loadProducts(){
    const [d,sd,kd]=await Promise.all([
      api('/admin/v2/products'),
      api('/admin/v2/subjects'),
      api('/admin/v2/kits')
    ]);

    const c=$('#am-content');
    const subjects=sd.subjects||[];
    const years=['1st Year','2nd Year','3rd Year','4th Year','Universal'];

    const subjectOptions=y=>subjects
      .filter(x=>x.academic_year===y&&x.active)
      .map(x=>`<option>${esc(x.subject_name)}</option>`)
      .join('');

    c.innerHTML=`<div class="am-products-heading">
        <div>
          <h2>Dental Store · Product catalogue</h2>
          <p class="am-note">Add dental products, essentials and academic resources. Notes, PYQs and Mind Maps require a PDF. Free resources allow full downloads; paid resources show a two-page preview.</p>
        </div>
        <button type="button" class="am-primary" id="open-kit-builder">＋ Create Kit</button>
      </div>

      <form id="subject-form" class="am-product-card">
        <h3>Manage academic subjects</h3>
        <div class="am-product-grid">
          <label>Academic year<select name="academic_year">${years.filter(x=>x!=='Universal').map(x=>`<option>${x}</option>`).join('')}</select></label>
          <label>New subject<input name="subject_name" maxlength="100" required></label>
        </div>
        <button class="am-quiet">Add subject</button>
      </form>

      <form id="product-form" class="am-product-form am-product-card">
        <h3>Add product</h3>

        <div class="am-product-grid">
          <label>Product name<input name="name" required maxlength="160"></label>
          <label>Price (₹)<input name="price" type="number" min="0" step=".01" required></label>
          <label>SKU<input name="sku" maxlength="80"></label>
          <label>Category<select name="store_group" id="product-category"><option value="DENTAL_STORE">Dental</option><option value="OTHER_ESSENTIALS">Others</option></select></label>
          <label>Academic year<select name="academic_year" id="p-year">${years.map(x=>`<option>${x}</option>`).join('')}<option>Internship</option></select></label>
          <label>Subject<select name="subject" id="p-subject"><option>Universal</option>${subjectOptions('1st Year')}</select></label>
          <label>Product type<select name="product_type"><option>Dental Store</option><option>Notes</option><option>Mind Maps</option><option>Quiz</option><option>PYQs</option><option>Books</option><option>Other</option></select></label>
          <label>Stock quantity (0 = unlimited)<input name="stock_quantity" type="number" min="0" value="0"></label>
          <label>Product images (up to 3)<input name="images" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
          <label>Search keywords<input name="search_keywords" placeholder="comma separated search terms"></label>
        </div>

        <section class="am-resource-upload" id="resource-pdf-section" hidden>
          <h4>Upload academic resource PDF</h4>
          <p class="am-note" id="resource-pdf-help">Upload the actual PDF students will access. Free resources allow full downloads; paid resources show only a two-page preview.</p>
          <label>Notes / PYQs / Mind Maps PDF <span aria-hidden="true">*</span><input name="resource_pdf" type="file" accept="application/pdf,.pdf"></label>
          <p class="am-note" id="resource-pdf-status">No PDF selected.</p>
          <small>PDF only · Maximum 15 MB. If editing, leave this empty to keep the previously uploaded PDF.</small>
        </section>

        <label>Description<textarea name="description" rows="3" maxlength="3000"></textarea></label>
        <label>Quality / specification note<textarea name="quality_note" rows="2" maxlength="1000" placeholder="Disclose grade, material, dimensions or limitations"></textarea></label>
        <button class="am-primary">Add product</button>
      </form>

      <section class="am-product-browser">
        <div class="am-product-browser-head">
          <div>
            <h3>Existing products</h3>
            <p class="am-note">Search and narrow the catalogue without scrolling through every product.</p>
          </div>
          <strong id="product-result-count">${d.products.length} products</strong>
        </div>

        <div class="am-product-filters" id="product-filters">
          <label class="am-product-search">Search products<input id="product-search" type="search" placeholder="Name, SKU, keyword or description"></label>
          <label>Academic year<select id="product-filter-year">${opt([...new Set(d.products.map(p=>p.academic_year).filter(Boolean))].sort(),'All years')}</select></label>
          <label>Subject<select id="product-filter-subject">${opt([...new Set(d.products.map(p=>p.subject).filter(Boolean))].sort(),'All subjects')}</select></label>
          <label>Product type<select id="product-filter-type">${opt([...new Set(d.products.map(p=>p.product_type).filter(Boolean))].sort(),'All types')}</select></label>
          <label>Category<select id="product-filter-category"><option value="">All categories</option><option value="DENTAL_STORE">Dental</option><option value="OTHER_ESSENTIALS">Others</option></select></label>
          <label>Status<select id="product-filter-status"><option value="">All statuses</option><option value="active">Active</option><option value="hidden">Hidden</option></select></label>
          <label>PDF<select id="product-filter-pdf"><option value="">All resources</option><option value="yes">PDF uploaded</option><option value="no">No PDF</option></select></label>
          <button type="button" class="am-quiet" id="clear-product-filters">Clear filters</button>
        </div>

        <div class="am-table">
          <table>
            <thead><tr><th>Product / images</th><th>Type / category</th><th>Subject / year</th><th>Price / stock</th><th>PDF</th><th>Status</th><th>Action</th></tr></thead>
            <tbody id="admin-products-rows">
              ${d.products.map(p=>{
                const imgs=Array.isArray(p.multi_images)?p.multi_images:(p.image_data?[p.image_data]:[]);

                return `<tr data-product-row="${p.id}">
                  <td>${imgs.map(im=>`<img class="am-product-thumb" src="${esc(im)}" alt="">`).join('')}<b>${esc(p.name)}</b><br><small>${esc(p.description||'')}</small></td>
                  <td>${esc(p.product_type)}<br>${p.store_group==='OTHER_ESSENTIALS'?'Others':'Dental'}</td>
                  <td>${esc(p.subject)} / ${esc(p.academic_year)}</td>
                  <td>₹${esc(p.price)}<br>Stock: ${Number(p.stock_quantity||0)}</td>
                  <td>${p.has_pdf?'Uploaded':'—'}</td>
                  <td>${p.active?'Active':'Hidden'}</td>
                  <td><button data-edit="${p.id}">Edit</button><button data-toggle="${p.id}">${p.active?'Hide':'Publish'}</button></td>
                </tr>`;
              }).join('')||'<tr><td colspan="7">No products added.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <h3>Created kits</h3>
      <div id="kit-management">${kitManagementHTML(kd.kits||[])}</div>`;

    // Bind kit actions in Products tab.
    const kitProducts=d.products.filter(p=>p.product_type==='Dental Store');

    bindKitManagement(
      $('#kit-management'),
      kd.kits||[],
      kitProducts,
      subjects,
      loadProducts
    );

    const productSearch=$('#product-search');
    const productYear=$('#product-filter-year');
    const productSubject=$('#product-filter-subject');
    const productType=$('#product-filter-type');
    const productCategory=$('#product-filter-category');
    const productStatus=$('#product-filter-status');
    const productPdf=$('#product-filter-pdf');

    const filterProducts=()=>{
      const q=(productSearch.value||'').trim().toLowerCase();
      let visible=0;

      d.products.forEach(p=>{
        const haystack=[
          p.name,p.sku,p.description,p.search_keywords,p.subject,
          p.academic_year,p.product_type,p.category
        ].join(' ').toLowerCase();

        const matches=
          (!q||haystack.includes(q))&&
          (!productYear.value||p.academic_year===productYear.value)&&
          (!productSubject.value||p.subject===productSubject.value)&&
          (!productType.value||p.product_type===productType.value)&&
          (!productCategory.value||(p.store_group||'DENTAL_STORE')===productCategory.value)&&
          (!productStatus.value||(productStatus.value==='active'?!!p.active:!p.active))&&
          (!productPdf.value||(productPdf.value==='yes'?!!p.has_pdf:!p.has_pdf));

        const row=c.querySelector(`[data-product-row="${p.id}"]`);

        if(row){
          row.hidden=!matches;
          if(matches)visible++;
        }
      });

      $('#product-result-count').textContent=`${visible} of ${d.products.length} products`;

      let empty=$('#product-filter-empty');

      if(visible===0){
        if(!empty){
          empty=document.createElement('p');
          empty.id='product-filter-empty';
          empty.className='am-filter-empty';
          $('#admin-products-rows').closest('.am-table').after(empty);
        }
        empty.textContent='No products match these filters.';
      }else if(empty){
        empty.remove();
      }
    };

    [productSearch,productYear,productSubject,productType,productCategory,productStatus,productPdf]
      .forEach(el=>el.addEventListener(el===productSearch?'input':'change',filterProducts));

    $('#clear-product-filters').onclick=()=>{
      [productSearch,productYear,productSubject,productType,productCategory,productStatus,productPdf]
        .forEach(el=>el.value='');
      filterProducts();
    };

    const pyear=$('#p-year');
    const psub=$('#p-subject');
    const ptype=$('#product-form').elements.product_type;
    const pdfSection=$('#resource-pdf-section');
    const pdfInput=$('#product-form').elements.resource_pdf;
    const pdfStatus=$('#resource-pdf-status');

    const isResourceType=()=>['Notes','PYQs','Mind Maps'].includes(ptype.value);

    const syncPdfField=(hasExisting=false)=>{
      const show=isResourceType();
      pdfSection.hidden=!show;
      pdfInput.required=show&&!hasExisting;

      if(!show){
        pdfInput.value='';
        pdfStatus.textContent='PDF upload is only used for Notes, PYQs and Mind Maps.';
      }else if(!pdfInput.files.length){
        pdfStatus.textContent=hasExisting?
          'An existing PDF is saved. Choose a file only if you want to replace it.':
          'No PDF selected. Upload the PDF before publishing.';
      }
    };

    ptype.addEventListener('change',()=>syncPdfField(false));

    pdfInput.addEventListener('change',()=>{
      const f=pdfInput.files[0];
      pdfStatus.textContent=f?
        `Selected: ${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`:
        'No PDF selected.';
    });

    syncPdfField(false);

    $('#open-kit-builder').onclick=()=>show('create-kit');

    $('#subject-form').onsubmit=async e=>{
      e.preventDefault();
      const b=Object.fromEntries(new FormData(e.target));

      try{
        await api('/admin/v2/subjects','POST',b);
        msg('Subject added to the selected academic year.');
        await loadProducts();
      }catch(x){
        msg(x.message);
      }
    };

    const updateSub=(yr,el)=>{
      el.innerHTML='<option>Universal</option>'+subjectOptions(yr.value);
    };

    pyear.onchange=()=>updateSub(pyear,psub);

    $('#product-form').elements.product_type.onchange=e=>{
      if(e.target.value==='Books'||e.target.value==='Other'){
        $('#product-form').elements.store_group.value='OTHER_ESSENTIALS';
      }
      syncPdfField(false);
    };

    const filesToData=async files=>{
      if(files.length>3)throw Error('You can upload a maximum of 3 images per product.');

      const arr=[];

      for(const f of [...files].slice(0,3)){
        if(f.size>1_800_000)throw Error(`${f.name} is larger than 1.8 MB.`);
        arr.push(await fileData(f));
      }

      return arr;
    };

    $('#product-form').elements.images.onchange=e=>{
      const fs=[...e.target.files];

      if(fs.length>3){
        e.target.value='';
        msg('Maximum 3 images per product.');
        return;
      }

      msg(fs.length?
        `${fs.length} product image(s) selected.`:
        'No new images selected; existing images will be kept when editing.');
    };

    $('#product-form').onsubmit=async e=>{
      e.preventDefault();

      const f=e.target;

      try{
        const b=Object.fromEntries(new FormData(f));

        b.multi_images=f.images.files.length?
          await filesToData(f.images.files):
          (
            f.dataset.editId&&d.products.find(p=>String(p.id)===f.dataset.editId)?.multi_images?.length?
            d.products.find(p=>String(p.id)===f.dataset.editId).multi_images:
            (
              d.products.find(p=>String(p.id)===f.dataset.editId)?.image_data?
              [d.products.find(p=>String(p.id)===f.dataset.editId).image_data]:
              []
            )
          );

        b.image_data=b.multi_images[0]||'';
        b.category=b.store_group==='OTHER_ESSENTIALS'?'Others':'Dental';

        delete b.images;

        b.price=Number(b.price);
        b.stock_quantity=Number(b.stock_quantity||0);

        const uploadedPdf=await pdfFileData(f.resource_pdf.files[0]);

        if(uploadedPdf){
          b.pdf_data=uploadedPdf.data;
          b.pdf_filename=uploadedPdf.filename;
        }

        delete b.resource_pdf;

        const editId=f.dataset.editId;

        if(editId){
          const old=d.products.find(p=>String(p.id)===editId);
          b.active=old.active;
          await api('/admin/v2/products/'+editId,'PATCH',b);
          msg('Product updated.');
        }else{
          await api('/admin/v2/products','POST',b);
          msg('Product added and published.');
        }

        f.reset();
        delete f.dataset.editId;
        syncPdfField(false);

        $('#product-form button[type="submit"],#product-form button.am-primary').textContent='Add product';

        await loadProducts();
      }catch(x){
        msg(x.message);
      }
    };

    c.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
      const p=d.products.find(x=>String(x.id)===b.dataset.edit);
      const f=$('#product-form');

      if(!p||!f)return;

      for(const key of [
        'name','price','sku','academic_year','product_type',
        'stock_quantity','search_keywords','quality_note','description','store_group'
      ]){
        if(f.elements[key])f.elements[key].value=p[key]??'';
      }

      updateSub(pyear,psub);

      if(f.elements.subject)f.elements.subject.value=p.subject||'Universal';

      f.dataset.editId=p.id;

      if(f.elements.resource_pdf)f.elements.resource_pdf.value='';

      syncPdfField(!!p.has_pdf);

      $('#product-form button[type="submit"],#product-form button.am-primary').textContent='Save product changes';

      f.scrollIntoView({behavior:'smooth'});
    });

    c.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{
      const p=d.products.find(x=>String(x.id)===b.dataset.toggle);

      try{
        await api('/admin/v2/products/'+p.id,'PATCH',{
          ...p,
          price:Number(p.price),
          active:!p.active,
          multi_images:Array.isArray(p.multi_images)?p.multi_images:[]
        });

        msg('Product visibility updated.');
        await loadProducts();
      }catch(e){
        msg(e.message);
      }
    });
  }

  // -------------------------------------------------------
  // QUIZZES
  // -------------------------------------------------------

  async function loadQuizzes(){
    try{
      const [d,sd]=await Promise.all([
        api('/admin/v2/quizzes'),
        api('/admin/v2/subjects')
      ]);

      const subjects=sd.subjects||[];
      const years=['1st Year','2nd Year','3rd Year','4th Year','Internship'];
      const optionsFor=y=>subjects
        .filter(x=>x.academic_year===y&&x.active)
        .map(x=>`<option value="${esc(x.subject_name)}">${esc(x.subject_name)}</option>`)
        .join('');

      const c=$('#am-content');

      c.innerHTML=`<h2>Quiz question bank</h2>
        <p class="am-note">Create and publish multiple-choice questions. Academic year and subject are mandatory. Students see the correct answer only after submitting their choice.</p>

        <form id="quiz-form" class="am-product-card">
          <input type="hidden" name="id">
          <label>Question<textarea name="question" rows="3" maxlength="5000" required placeholder="Enter the question"></textarea></label>

          <div class="am-product-grid">
            <label>Option A<input name="option_a" maxlength="1000" required></label>
            <label>Option B<input name="option_b" maxlength="1000" required></label>
            <label>Option C<input name="option_c" maxlength="1000" required></label>
            <label>Option D<input name="option_d" maxlength="1000" required></label>
          </div>

          <div class="am-product-grid">
            <label>Academic year<select name="academic_year" id="quiz-admin-year" required><option value="">Select year</option>${years.map(y=>`<option>${esc(y)}</option>`).join('')}</select></label>
            <label>Subject<select name="subject" id="quiz-admin-subject" required><option value="">Select year first</option></select></label>
            <label>Correct option<select name="correct_option" required><option value="">Choose correct option</option><option value="A">Option A</option><option value="B">Option B</option><option value="C">Option C</option><option value="D">Option D</option></select></label>
          </div>

          <label>Explanation / suggestion (optional)<textarea name="explanation" rows="2" maxlength="5000" placeholder="Explain why this is the correct answer"></textarea></label>
          <label class="am-check"><input type="checkbox" name="published" checked> Publish question for students</label>
          <button class="am-primary" id="quiz-save">Add question</button>
          <button type="button" class="am-quiet" id="quiz-reset">Clear form</button>
        </form>

        <h3>Existing questions (${d.questions.length})</h3>
        <div class="am-filters">
          <input id="quiz-search" placeholder="Search question text">
          <select id="quiz-filter-year">${opt(years,'All years')}</select>
          <select id="quiz-filter-subject">${opt([...new Set(subjects.map(x=>x.subject_name))],'All subjects')}</select>
          <select id="quiz-filter-status">${opt(['published','draft'],'All statuses')}</select>
          <button id="quiz-filter-apply">Filter</button>
        </div>
        <div id="quiz-table" class="am-table"></div>`;

      const form=$('#quiz-form');
      const y=$('#quiz-admin-year');
      const sub=$('#quiz-admin-subject');

      const updateSub=()=>{
        const old=sub.value;
        sub.innerHTML='<option value="">Select subject</option>'+optionsFor(y.value);
        if([...sub.options].some(o=>o.value===old))sub.value=old;
      };

      y.onchange=updateSub;

      const reset=()=>{
        form.reset();
        form.elements.id.value='';
        form.elements.published.checked=true;
        updateSub();
        $('#quiz-save').textContent='Add question';
      };

      $('#quiz-reset').onclick=reset;

      form.onsubmit=async e=>{
        e.preventDefault();

        const b=Object.fromEntries(new FormData(form));
        b.published=form.elements.published.checked;

        const id=b.id;
        delete b.id;

        try{
          await api('/admin/v2/quizzes'+(id?'/'+id:''),id?'PATCH':'POST',b);
          msg(id?'Quiz question updated.':'Quiz question added.');
          await loadQuizzes();
        }catch(x){
          msg(x.message);
        }
      };

      const renderTable=async()=>{
        try{
          const x=await api('/admin/v2/quizzes?'+qs({
            q:$('#quiz-search').value,
            year:$('#quiz-filter-year').value,
            subject:$('#quiz-filter-subject').value,
            status:$('#quiz-filter-status').value
          }));

          $('#quiz-table').innerHTML=`<table>
            <thead><tr><th>Question</th><th>Year / Subject</th><th>Correct option</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${x.questions.map(q=>`<tr>
                <td>${esc(q.question)}</td>
                <td>${esc(q.academic_year)}<br>${esc(q.subject)}</td>
                <td>${esc(q.correct_option)}. ${esc(q['option_'+q.correct_option.toLowerCase()])}</td>
                <td>${q.published?'Published':'Draft'}</td>
                <td><button data-quiz-edit="${q.id}">Edit</button><button class="am-danger" data-quiz-delete="${q.id}">Delete</button></td>
              </tr>`).join('')||'<tr><td colspan="5">No questions match these filters.</td></tr>'}
            </tbody>
          </table>`;

          $('#quiz-table').querySelectorAll('[data-quiz-edit]').forEach(btn=>btn.onclick=()=>{
            const q=x.questions.find(z=>String(z.id)===btn.dataset.quizEdit);

            for(const k of ['question','option_a','option_b','option_c','option_d','correct_option','explanation','academic_year']){
              form.elements[k].value=q[k]??'';
            }

            form.elements.published.checked=q.published;
            updateSub();
            form.elements.subject.value=q.subject;
            form.elements.id.value=q.id;
            $('#quiz-save').textContent='Save question';
            form.scrollIntoView({behavior:'smooth'});
          });

          $('#quiz-table').querySelectorAll('[data-quiz-delete]').forEach(btn=>btn.onclick=async()=>{
            const q=x.questions.find(z=>String(z.id)===btn.dataset.quizDelete);
            if(!confirm('Delete this quiz question?'))return;

            try{
              await api('/admin/v2/quizzes/'+q.id,'DELETE');
              msg('Quiz question deleted.');
              await renderTable();
            }catch(e){
              msg(e.message);
            }
          });
        }catch(e){
          msg(e.message);
        }
      };

      $('#quiz-filter-apply').onclick=renderTable;
      await renderTable();
    }catch(e){
      $('#am-content').innerHTML=`<section class="am-product-card">
        <h2>Unable to load Quiz Questions</h2>
        <p>${esc(e.message)}</p>
        <p class="am-note">Run database/module_04_quiz_study_partner.sql in Neon, then refresh.</p>
      </section>`;
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // FAQS
  // -------------------------------------------------------

  async function loadFaqs(){
    const d=await api('/admin/v2/faqs');
    const c=$('#am-content');

    c.innerHTML=`<h2>Manage FAQs</h2>
      <form id="faq-form" class="am-product-card">
        <input type="hidden" name="id">
        <label>Question<input name="question" maxlength="500" required></label>
        <label>Answer<textarea name="answer" rows="4" maxlength="10000" required></textarea></label>
        <div class="am-product-grid">
          <label>Display order<input name="sort_order" type="number" value="0"></label>
          <label class="am-check"><input name="published" type="checkbox"> Published on student website</label>
        </div>
        <button class="am-primary" id="faq-save">Add FAQ</button>
        <button type="button" id="faq-reset" class="am-quiet">Clear form</button>
      </form>

      <h3>Existing FAQs</h3>
      <div class="am-table">
        <table>
          <thead><tr><th>Question</th><th>Answer</th><th>Order</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${d.faqs.map(f=>`<tr>
              <td>${esc(f.question)}</td>
              <td>${esc(f.answer)}</td>
              <td>${f.sort_order}</td>
              <td>${f.published?'Published':'Draft'}</td>
              <td><button data-faq-edit="${f.id}">Edit</button><button class="am-danger" data-faq-delete="${f.id}">Delete</button></td>
            </tr>`).join('')||'<tr><td colspan="5">No FAQs created yet.</td></tr>'}
          </tbody>
        </table>
      </div>`;

    const form=$('#faq-form');

    $('#faq-reset').onclick=()=>{
      form.reset();
      form.elements.id.value='';
      $('#faq-save').textContent='Add FAQ';
    };

    form.onsubmit=async e=>{
      e.preventDefault();

      const b=Object.fromEntries(new FormData(form));
      b.published=form.published.checked;
      b.sort_order=Number(b.sort_order||0);

      const id=b.id;
      delete b.id;

      try{
        await api('/admin/v2/faqs'+(id?'/'+id:''),id?'PATCH':'POST',b);
        msg(id?'FAQ updated.':'FAQ created.');
        await loadFaqs();
      }catch(x){
        msg(x.message);
      }
    };

    c.querySelectorAll('[data-faq-edit]').forEach(b=>b.onclick=()=>{
      const f=d.faqs.find(x=>String(x.id)===b.dataset.faqEdit);
      form.elements.id.value=f.id;
      form.question.value=f.question;
      form.answer.value=f.answer;
      form.sort_order.value=f.sort_order;
      form.published.checked=f.published;
      $('#faq-save').textContent='Save changes';
      form.scrollIntoView({behavior:'smooth'});
    });

    c.querySelectorAll('[data-faq-delete]').forEach(b=>b.onclick=async()=>{
      const f=d.faqs.find(x=>String(x.id)===b.dataset.faqDelete);
      if(!confirm(`Delete FAQ "${f.question}"?`))return;

      try{
        await api('/admin/v2/faqs/'+f.id,'DELETE');
        msg('FAQ deleted.');
        await loadFaqs();
      }catch(x){
        msg(x.message);
      }
    });
  }

  // -------------------------------------------------------
  // REVIEWS
  // -------------------------------------------------------

  async function loadReviews(){
    try{
      const d=await api('/admin/v2/reviews');
      const c=$('#am-content');

      c.innerHTML=`<h2>Product reviews</h2>
        <p class="am-note">Approve reviews before they become visible to students.</p>
        <div class="am-table">
          <table>
            <thead><tr><th>Product</th><th>Reviewer</th><th>Order</th><th>Rating</th><th>Review</th><th>Status / action</th></tr></thead>
            <tbody>
              ${d.reviews.map(r=>`<tr>
                <td>${esc(r.product_name)}</td>
                <td>${esc(r.reviewer||'Deleted user')}</td>
                <td>${esc(r.invoice)}</td>
                <td>${'★'.repeat(Number(r.rating))}</td>
                <td>${esc(r.review_text||'—')}</td>
                <td>
                  ${esc(r.status)}<br>
                  ${r.status!=='PUBLISHED'?`<button data-review-status="PUBLISHED" data-review-id="${r.id}">Publish</button>`:''}
                  ${r.status!=='REJECTED'?`<button class="am-danger" data-review-status="REJECTED" data-review-id="${r.id}">Reject</button>`:''}
                </td>
              </tr>`).join('')||'<tr><td colspan="6">No reviews submitted yet.</td></tr>'}
            </tbody>
          </table>
        </div>`;

      c.querySelectorAll('[data-review-status]').forEach(b=>b.onclick=async()=>{
        try{
          await api('/admin/v2/reviews/'+b.dataset.reviewId,'PATCH',{status:b.dataset.reviewStatus});
          msg('Review status updated.');
          await loadReviews();
        }catch(e){
          msg(e.message);
        }
      });
    }catch(e){
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // PRIVATE FEEDBACK
  // -------------------------------------------------------

  async function loadPrivateFeedback(){
    try{
      const d=await api('/admin/v2/private-feedback');
      const c=$('#am-content');

      c.innerHTML=`<h2>Private order feedback</h2>
        <p class="am-note">Visible only to administrators; never published on product pages.</p>
        <div class="am-table">
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Order</th><th>Product</th><th>Feedback</th></tr></thead>
            <tbody>
              ${d.feedback.map(f=>`<tr>
                <td>${new Date(f.created_at).toLocaleString('en-IN')}</td>
                <td>${esc(f.customer_name||'Customer')}</td>
                <td>${esc(f.invoice||'—')}</td>
                <td>${esc(f.product_name||'—')}</td>
                <td>${esc(f.message)}</td>
              </tr>`).join('')||'<tr><td colspan="5">No private order feedback yet.</td></tr>'}
            </tbody>
          </table>
        </div>`;
    }catch(e){
      msg(e.message);
    }
  }

  // -------------------------------------------------------
  // OPPORTUNITIES
  // -------------------------------------------------------

  async function loadOpportunities(){
    const d=await api('/admin/v2/opportunities');
    const c=$('#am-content');

    c.innerHTML=`<h2>Manage Join Us opportunities</h2>
      <form id="opp-form" class="am-product-card">
        <input type="hidden" name="id">

        <div class="am-product-grid">
          <label>Role / opportunity title<input name="title" maxlength="160" required></label>
          <label>Location<input name="location" value="Remote"></label>
          <label>Work type<input name="work_type" value="Flexible" placeholder="Internship, Part-time…"></label>
          <label>Application URL (HTTPS)<input name="application_url" type="url" placeholder="https://…"></label>
          <label>Status<select name="status"><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="CLOSED">Closed</option></select></label>
        </div>

        <label>Description<textarea name="description" rows="4" maxlength="10000" required></textarea></label>
        <label>Requirements<textarea name="requirements" rows="3" maxlength="5000"></textarea></label>
        <button class="am-primary" id="opp-save">Add opportunity</button>
        <button type="button" id="opp-reset" class="am-quiet">Clear form</button>
      </form>

      <h3>Existing opportunities</h3>
      <div class="am-table">
        <table>
          <thead><tr><th>Role</th><th>Location / type</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${d.opportunities.map(o=>`<tr>
              <td><b>${esc(o.title)}</b><br>${esc(o.description)}</td>
              <td>${esc(o.location)} / ${esc(o.work_type)}</td>
              <td>${esc(o.status)}</td>
              <td><button data-opp-edit="${o.id}">Edit</button><button class="am-danger" data-opp-delete="${o.id}">Delete</button></td>
            </tr>`).join('')||'<tr><td colspan="4">No opportunities created yet.</td></tr>'}
          </tbody>
        </table>
      </div>`;

    const form=$('#opp-form');

    $('#opp-reset').onclick=()=>{
      form.reset();
      form.elements.id.value='';
      form.location.value='Remote';
      form.work_type.value='Flexible';
      $('#opp-save').textContent='Add opportunity';
    };

    form.onsubmit=async e=>{
      e.preventDefault();

      const b=Object.fromEntries(new FormData(form));
      const id=b.id;
      delete b.id;

      try{
        await api('/admin/v2/opportunities'+(id?'/'+id:''),id?'PATCH':'POST',b);
        msg(id?'Opportunity updated.':'Opportunity created.');
        await loadOpportunities();
      }catch(x){
        msg(x.message);
      }
    };

    c.querySelectorAll('[data-opp-edit]').forEach(b=>b.onclick=()=>{
      const o=d.opportunities.find(x=>String(x.id)===b.dataset.oppEdit);
      form.elements.id.value=o.id;

      for(const k of ['title','description','requirements','location','work_type','application_url','status']){
        form.elements[k].value=o[k]??'';
      }

      $('#opp-save').textContent='Save changes';
      form.scrollIntoView({behavior:'smooth'});
    });

    c.querySelectorAll('[data-opp-delete]').forEach(b=>b.onclick=async()=>{
      const o=d.opportunities.find(x=>String(x.id)===b.dataset.oppDelete);
      if(!confirm(`Delete "${o.title}"?`))return;

      try{
        await api('/admin/v2/opportunities/'+o.id,'DELETE');
        msg('Opportunity deleted.');
        await loadOpportunities();
      }catch(x){
        msg(x.message);
      }
    });
  }

  // -------------------------------------------------------
  // INITIALIZE
  // -------------------------------------------------------

  if(token)ownerWelcome();
  else login();

})();
