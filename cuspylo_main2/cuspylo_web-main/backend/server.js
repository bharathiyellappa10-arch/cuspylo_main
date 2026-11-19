const pool = require('./db');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env')
});
const C = require('./config');

if (!C.secret || !C.admin.id || !C.admin.password) {
  throw new Error(
    'Missing SECRET, ADMIN_ID or ADMIN_PASS in environment configuration.'
  );
}
const app = express();

const clean = (v, n = 200) =>
  String(v ?? '').trim().slice(0, n);

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');

function same(pw, stored) {
  try {
    const [salt, key] = String(stored).split(':');
    const actual = crypto.scryptSync(String(pw), salt, 64);
    const expected = Buffer.from(key, 'hex');

    return expected.length === actual.length &&
      crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Security answers are normalized before hashing so harmless case/spacing
// differences do not lock a legitimate user out of account recovery.
const normalizeRecoveryAnswer = value =>
  String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const RECOVERY_QUESTIONS = {
  favourite_place: 'What is your favourite place in the world?',
  favourite_word: 'What is your favourite English word?',
  first_school: 'What was the name of your first school?',
  fictional_character: 'Who is your favourite fictional character?',
  childhood_nickname: 'What was your childhood nickname?',
  childhood_memory: 'What is a memorable childhood memory?'
};

const validRecoveryQuestion = id =>
  Object.prototype.hasOwnProperty.call(RECOVERY_QUESTIONS, String(id));

const recoveryAnswerHash = answer => hash(normalizeRecoveryAnswer(answer));

const hmac = p =>
  crypto.createHmac('sha256', C.secret)
    .update(p)
    .digest('base64url');

const sign = payload => {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return p + '.' + hmac(p);
};

function verify(token) {
  try {
    const [p, sig] = String(token || '').split('.');

    if (!p || !sig) return null;

    const expected = Buffer.from(hmac(p));
    const received = Buffer.from(sig);

    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) return null;

    const data = JSON.parse(
      Buffer.from(p, 'base64url').toString('utf8')
    );

    if (data.exp && Date.now() > data.exp) return null;

    return data;
  } catch {
    return null;
  }
}

// Every student request checks the live database status. A suspension or
// deletion therefore takes effect immediately, including for existing tokens.
const auth = role => async (req, res, next) => {
  const payload = verify(
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  );
  if (!payload || (role && payload.role !== role)) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  if (payload.role === 'user') {
    try {
      const result = await pool.query(
        `SELECT account_status, role, token_version FROM users WHERE id=$1 LIMIT 1`,
        [payload.userId]
      );
      const account = result.rows[0];
      if (!account || account.role !== 'user' || account.account_status !== 'active' || Number(account.token_version || 0) !== Number(payload.tokenVersion || 0)) {
        return res.status(403).json({
          error: account?.account_status === 'suspended'
            ? 'Your account is suspended. Contact CUSPYLO support.'
            : 'This account is no longer active. Please contact CUSPYLO support.'
        });
      }
    } catch (error) {
      console.error('Account status check failed:', error.message);
      return res.status(503).json({ error: 'Unable to verify account status. Try again.' });
    }
  }
  req.auth = payload;
  next();
};

app.use(express.json({ limit: '32mb' }));

app.use(express.static(
  path.join(__dirname, '..', 'frontend')
));

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT current_database() AS database_name'
    );

    res.json({
      ok: true,
      service: 'CUSPYLO',
      storage: 'PostgreSQL',
      database: result.rows[0].database_name
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);

    res.status(503).json({
      ok: false,
      service: 'CUSPYLO',
      storage: 'PostgreSQL',
      error: 'Database unavailable'
    });
  }
});

// Frontend configuration
app.get('/api/config', (_req, res) => {
  res.json({
    slots: C.slots,
    defaultPrice: C.defaultPrice,
    whatsapp: C.whatsapp,
    email: C.email,
    instagram: C.instagram,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || ''
  });
});

// Student registration
app.post('/api/signup', async (req, res) => {
  try {
    const b = req.body || {};
    const name = clean(b.name, 80);
    const phone = clean(b.phone, 20).replace(/[\s()-]/g, '');
    const email = clean(b.email, 120).toLowerCase();
    const college = clean(b.college, 120);
    const academicYear = clean(b.academicYear, 30);
    const password = String(b.password || '');
    const confirmPassword = String(b.confirmPassword || '');
    const recoveryQuestions = [
      { id: clean(b.securityQuestion1, 40), answer: String(b.securityAnswer1 || '') },
      { id: clean(b.securityQuestion2, 40), answer: String(b.securityAnswer2 || '') },
      { id: clean(b.securityQuestion3, 40), answer: String(b.securityAnswer3 || '') }
    ];

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const phoneDigits = phone.replace(/^\+91/, '').replace(/\D/g, '');
    const passwordClasses = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length;

    if (!name || !phone || !email || !college || !academicYear) {
      return res.status(400).json({
        error: 'Complete all required fields.'
      });
    }

    if (!emailOk) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    if (phoneDigits.length !== 10) {
      return res.status(400).json({
        error: 'Enter a valid 10-digit Indian mobile number.'
      });
    }

    if (password.length < 8 || passwordClasses < 3) {
      return res.status(400).json({
        error: 'Choose a stronger password: at least 8 characters and 3 of these 4 types — lowercase, uppercase, number and symbol.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (recoveryQuestions.some(q => !validRecoveryQuestion(q.id) || normalizeRecoveryAnswer(q.answer).length < 2) ||
        new Set(recoveryQuestions.map(q => q.id)).size !== 3) {
      return res.status(400).json({ error: 'Choose three different security questions and provide all three answers (at least 2 characters each).' });
    }

    // Email is the canonical username; students can also sign in using phone.
    const username = email;
    const passwordHash = hash(password);

    const result = await pool.query(
      `INSERT INTO users
       (name, username, phone, email, college,
        academic_year, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user')
       RETURNING id, name, username, phone, email,
                 college, academic_year, pincode, role, created_at`,
      [name, username, phoneDigits, email, college, academicYear, passwordHash]
    );

    const savedUser = result.rows[0];
    for (let i = 0; i < recoveryQuestions.length; i++) {
      const q = recoveryQuestions[i];
      await pool.query(
        `INSERT INTO user_security_questions (user_id, question_id, answer_hash)
         VALUES ($1, $2, $3)`,
        [savedUser.id, q.id, recoveryAnswerHash(q.answer)]
      );
    }
    const token = sign({
      role: 'user',
      userId: savedUser.id,
      username: savedUser.username,
      tokenVersion: 0,
      exp: Date.now() + 7 * 864e5
    });

    res.status(201).json({
      token,
      user: {
        id: savedUser.id,
        name: savedUser.name,
        username: savedUser.username,
        phone: savedUser.phone,
        email: savedUser.email,
        college: savedUser.college,
        academic_year: savedUser.academic_year,
        recoveryConfigured: true
      }
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'This phone number or email is already registered.'
      });
    }

    console.error('SIGNUP FAILURE DETAILS:', {
  name: error?.name,
  message: error?.message,
  code: error?.code,
  detail: error?.detail,
  table: error?.table,
  column: error?.column,
  stack: error?.stack
});
    res.status(500).json({
      error: 'Unable to create account. Please try again.'
    });
  }
});

// Student login: accept email, mobile number or legacy username.
app.post('/api/login', async (req, res) => {
  try {
    const b = req.body || {};
    const identifier = clean(b.identifier || b.username, 120).toLowerCase();
    const password = String(b.password || '');

    const result = await pool.query(
      `SELECT id, name, username, phone, email, college,
              academic_year, password_hash, role, account_status, token_version,
              EXISTS (SELECT 1 FROM user_security_questions usq WHERE usq.user_id=users.id) AS recovery_configured
       FROM users
       WHERE role = 'user' AND account_status = 'active'
         AND (
           lower(username) = $1 OR
           lower(email) = $1 OR
           regexp_replace(phone, '\\D', '', 'g') =
             regexp_replace($1, '\\D', '', 'g')
         )
       LIMIT 1`,
      [identifier]
    );

    const u = result.rows[0];

    if (!u || !same(password, u.password_hash)) {
      return res.status(401).json({
        error: 'Wrong email/mobile number or password.'
      });
    }

    res.json({
      token: sign({
        role: 'user',
        userId: u.id,
        username: u.username,
        tokenVersion: Number(u.token_version || 0),
        exp: Date.now() + 7 * 864e5
      }),
      user: {
        id: u.id,
        name: u.name,
        username: u.username,
        phone: u.phone,
        email: u.email,
        college: u.college,
        academic_year: u.academic_year,
        recoveryConfigured: Boolean(u.recovery_configured)
      }
    });
  } catch (error) {
    console.error('LOGIN FAILURE DETAILS:', {
  name: error?.name,
  message: error?.message,
  code: error?.code,
  detail: error?.detail,
  table: error?.table,
  column: error?.column,
  stack: error?.stack
});
    res.status(500).json({
      error: 'Unable to sign in. Please try again.'
    });
  }
});

// Existing users configure recovery questions after their next successful login.
app.post('/api/password-recovery/setup', auth('user'), async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const questions = [
      { id: clean(b.securityQuestion1, 40), answer: String(b.securityAnswer1 || '') },
      { id: clean(b.securityQuestion2, 40), answer: String(b.securityAnswer2 || '') },
      { id: clean(b.securityQuestion3, 40), answer: String(b.securityAnswer3 || '') }
    ];
    if (questions.some(q => !validRecoveryQuestion(q.id) || normalizeRecoveryAnswer(q.answer).length < 2) ||
        new Set(questions.map(q => q.id)).size !== 3) {
      return res.status(400).json({ error: 'Choose three different security questions and provide all three answers (at least 2 characters each).' });
    }
    await client.query('BEGIN');
    await client.query('DELETE FROM user_security_questions WHERE user_id=$1', [req.auth.userId]);
    for (const q of questions) {
      await client.query(
        `INSERT INTO user_security_questions(user_id, question_id, answer_hash) VALUES ($1,$2,$3)`,
        [req.auth.userId, q.id, recoveryAnswerHash(q.answer)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Recovery setup failed:', error.message);
    res.status(500).json({ error: 'Unable to save recovery questions. Please try again.' });
  } finally {
    client.release();
  }
});

// Password recovery: security-question challenge and one-time reset authorization.
app.get('/api/password-recovery/question-list', (_req, res) => {
  res.json({ questions: RECOVERY_QUESTIONS });
});

app.post('/api/password-recovery/questions', async (req, res) => {
  try {
    const email = clean(req.body?.email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid registered email address.' });
    }
    const userResult = await pool.query(
      `SELECT id FROM users WHERE lower(email)=$1 AND role='user' AND account_status='active' LIMIT 1`,
      [email]
    );
    const account = userResult.rows[0];
    if (!account) return res.status(404).json({ error: 'If this account exists and has recovery questions configured, they can be used to recover it.' });
    const qResult = await pool.query(
      `SELECT question_id FROM user_security_questions WHERE user_id=$1 ORDER BY question_id`,
      [account.id]
    );
    if (qResult.rows.length !== 3) {
      return res.status(409).json({ error: 'This account has not configured security questions. Please contact CUSPYLO support.' });
    }
    res.json({ questions: qResult.rows.map(row => ({ id: row.question_id, question: RECOVERY_QUESTIONS[row.question_id] })) });
  } catch (error) {
    console.error('Recovery question lookup failed:', error.message);
    res.status(500).json({ error: 'Unable to start password recovery. Please try again.' });
  }
});

app.post('/api/password-recovery/verify', async (req, res) => {
  const client = await pool.connect();
  try {
    const email = clean(req.body?.email, 120).toLowerCase();
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!email || answers.length !== 3) return res.status(400).json({ error: 'Complete all three security answers.' });

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO password_recovery_attempts(email, failed_attempts, updated_at)
       VALUES ($1, 0, NOW()) ON CONFLICT (email) DO NOTHING`, [email]
    );
    const attemptResult = await client.query(
      `SELECT failed_attempts, locked_until FROM password_recovery_attempts WHERE email=$1 FOR UPDATE`, [email]
    );
    const attempt = attemptResult.rows[0];
    if (attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'Too many incorrect attempts. Try again later.' });
    }

    const userResult = await client.query(
      `SELECT id FROM users WHERE lower(email)=$1 AND role='user' AND account_status='active' LIMIT 1`, [email]
    );
    const account = userResult.rows[0];
    const savedResult = account ? await client.query(
      `SELECT question_id, answer_hash FROM user_security_questions WHERE user_id=$1`, [account.id]
    ) : { rows: [] };
    const submitted = new Map(answers.map(a => [String(a.questionId || ''), String(a.answer || '')]));
    const correct = Boolean(account && savedResult.rows.length === 3 && savedResult.rows.every(row =>
      submitted.has(row.question_id) && same(normalizeRecoveryAnswer(submitted.get(row.question_id)), row.answer_hash)
    ));

    if (!correct) {
      const failures = Number(attempt.failed_attempts || 0) + 1;
      const lockMinutes = failures >= 5 ? 30 : 0;
      await client.query(
        `UPDATE password_recovery_attempts
         SET failed_attempts=$2, locked_until=CASE WHEN $3 > 0 THEN NOW() + ($3 || ' minutes')::interval ELSE NULL END, updated_at=NOW()
         WHERE email=$1`, [email, failures, lockMinutes]
      );
      await client.query('COMMIT');
      return res.status(400).json({ error: 'The security answers could not be verified. Check your answers and try again.' });
    }

    await client.query(`UPDATE password_recovery_attempts SET failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE email=$1`, [email]);
    const resetToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    await client.query(
      `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`, [account.id, tokenHash]
    );
    await client.query('COMMIT');
    res.json({ resetToken, expiresInSeconds: 600 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Recovery verification failed:', error.message);
    res.status(500).json({ error: 'Unable to verify recovery answers. Please try again.' });
  } finally {
    client.release();
  }
});

app.post('/api/password-recovery/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    const resetToken = String(req.body?.resetToken || '');
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
    if (password.length < 8 || classes < 3) return res.status(400).json({ error: 'Use at least 8 characters and 3 character types.' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
    if (resetToken.length < 30) return res.status(400).json({ error: 'Recovery session is invalid or expired. Start again.' });
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [tokenHash]
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Recovery session is invalid, expired or already used. Start again.' });
    }
    await client.query(`UPDATE users SET password_hash=$1, token_version=COALESCE(token_version,0)+1, updated_at=NOW() WHERE id=$2 AND role='user' AND account_status='active'`, [hash(password), tokenRow.user_id]);
    await client.query(`UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL`, [tokenRow.user_id]);
    // Revoke existing signed-in sessions by changing the per-user token version.
    await client.query('COMMIT');
    res.json({ ok: true, message: 'Password updated. Please sign in using your new password.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Password reset failed:', error.message);
    res.status(500).json({ error: 'Unable to reset password. Please try again.' });
  } finally {
    client.release();
  }
});

// Separate admin login
app.post('/api/admin/login', (req, res) => {
  const b = req.body || {};

  if (
    clean(b.id) !== C.admin.id ||
    String(b.password || '') !== C.admin.password
  ) {
    return res.status(401).json({
      error: 'Invalid admin ID or password.'
    });
  }

  res.json({
    token: sign({
      role: 'admin',
      exp: Date.now() + 12 * 3600e3
    }),
    user: { name: 'CUSPYLO Admin' }
  });
});

// Current logged-in user
app.get('/api/me', auth(), async (req, res) => {
  if (req.auth.role === 'admin') {
    return res.json({
      role: 'admin',
      user: { name: 'CUSPYLO Admin' }
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, username, phone, email,
              college, academic_year, pincode, role, created_at
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [req.auth.username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        error: 'Account not found.'
      });
    }

    res.json({ role: 'user', user });

  } catch (error) {
    console.error('Current user error:', error.message);

    res.status(500).json({
      error: 'Unable to retrieve account.'
    });
  }
});

// Student order history — Neon is the source of truth.
app.get('/api/my/orders', auth('user'), async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT o.*,
        COALESCE(json_agg(json_build_object('id',oi.id,'item_type',oi.item_type,'product_id',oi.product_id,
          'item_name',oi.item_name,'fdi_number',oi.fdi_number,'quantity',oi.quantity,
          'unit_price',oi.unit_price,'line_total',oi.line_total))
          FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS line_items,
        COALESCE((SELECT json_agg(json_build_object('status',h.new_status,'at',h.created_at) ORDER BY h.created_at)
          FROM order_status_history h WHERE h.order_id=o.id), '[]'::json) AS tracking
      FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`, [req.auth.userId]);
    res.json({ orders: q.rows.map(orderForClient) });
  } catch (e) {
    console.error('Student orders:', e.message);
    res.status(500).json({ error: 'Unable to load your orders.' });
  }
});

function orderForClient(row) {
  const lineItems = row.line_items || [];
  const latest = String(row.order_status || 'RECEIVED');
  const statusMap = { RECEIVED:'Received', PACKED:'Packed', OUT_FOR_DELIVERY:'Out for Delivery', DELIVERED:'Delivered', CANCELLED:'Cancelled' };
  const status = statusMap[latest] || latest;
  return {
    id: row.id, invoice: row.invoice, userId: row.user_id, username: row.username || '',
    name: row.customer_name, phone: row.customer_phone, email: row.customer_email || '',
    college: row.college || '', address: row.address || '', pincode: row.pincode || '',
    items: lineItems.map(x => ({product_id:x.product_id,name:x.item_name,quantity:Number(x.quantity||1),price:Number(x.unit_price||0)})), lineItems, unit: lineItems[0]?.unit_price ? Number(lineItems[0].unit_price) : 0,
    total: Number(row.total), subtotal: Number(row.subtotal), deliveryCharge: Number(row.delivery_charge),
    discount: Number(row.discount), payment: row.payment_method, paymentStatus: row.payment_status,
    status: status === 'Delivered' ? 'Completed' : status, date: row.created_at, tracking: (row.tracking || []).map(h => ({...h, status: statusMap[h.status] || h.status}))
  };
}

// Public student catalogue: only active products are exposed.
app.get('/api/products', async (req, res) => {
  try {
    const q = clean(req.query.q,120), year = clean(req.query.year,30), subject = clean(req.query.subject,100), group = clean(req.query.group,40);
    const r = await pool.query(`SELECT id,name,description,image_data,multi_images,price,category,subject,academic_year,product_type,store_group,search_keywords,stock_quantity,quality_note,pdf_filename,(resource_pdf IS NOT NULL) AS has_pdf,(seller_listing_id IS NOT NULL) AS sold_by_user,seller_listing_id,created_at
      FROM admin_products WHERE active=true
      AND ($1='' OR academic_year IN ('Universal',$1))
      AND ($2='' OR subject IN ('Universal',$2))
      AND ($3='' OR store_group=$3)
      AND ($4='' OR NOT EXISTS (
        SELECT 1 FROM unnest(regexp_split_to_array(lower(trim($4)), '\\s+')) AS term
        WHERE term<>'' AND concat_ws(' ',lower(name),lower(description),lower(sku),lower(category),lower(subject),lower(academic_year),lower(search_keywords)) NOT LIKE '%'||term||'%' AND concat_ws(' ',lower(name),lower(description),lower(sku),lower(category),lower(subject),lower(academic_year),lower(search_keywords)) NOT LIKE '%'||regexp_replace(term,'s$','')||'%'
      ))
      ORDER BY CASE WHEN $4<>'' AND lower(name)=lower($4) THEN 0 WHEN $4<>'' AND lower(name) LIKE lower($4)||'%' THEN 1 WHEN $4<>'' AND lower(name) LIKE '%'||lower($4)||'%' THEN 2 ELSE 3 END, created_at DESC LIMIT 250`, [year,subject,group,q]);
    res.json({ products: r.rows });
  } catch (e) {
    console.error('Product catalogue:', e.message);
    res.status(500).json({ error: 'Unable to load products.' });
  }
});


// Academic resources: PDF bytes are never exposed by the public product catalogue.
// Free resources may be downloaded in full; paid resources receive a server-generated
// two-page preview only. A student JWT and active product are required.
app.get('/api/resources/:id/pdf', auth('user'), async (req,res) => {
  const mode = clean(req.query.mode || 'preview', 20);
  if (!['preview','download'].includes(mode)) return res.status(400).json({error:'Invalid PDF access mode.'});
  try {
    const result = await pool.query(
      `SELECT id,name,price,product_type,resource_pdf,pdf_filename
       FROM admin_products WHERE id=$1 AND active=true
       AND product_type IN ('Notes','PYQs','Mind Maps') LIMIT 1`,
      [req.params.id]
    );
    const resource = result.rows[0];
    if (!resource || !resource.resource_pdf) return res.status(404).json({error:'This resource PDF is unavailable.'});

    const isFree = Number(resource.price) === 0;
    if (mode === 'download' && !isFree) {
      return res.status(403).json({error:'Full downloads are available only for free resources.'});
    }

    let output;
    let filename = String(resource.pdf_filename || 'resource.pdf').replace(/[^a-zA-Z0-9._ -]/g,'_');
    if (isFree && mode === 'download') {
      output = Buffer.from(resource.resource_pdf);
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      const source = await PDFDocument.load(Buffer.from(resource.resource_pdf), {ignoreEncryption:false});
      const preview = await PDFDocument.create();
      const pageCount = Math.min(2, source.getPageCount());
      if (pageCount < 1) return res.status(422).json({error:'This PDF contains no pages.'});
      const pages = await preview.copyPages(source, Array.from({length:pageCount},(_,i)=>i));
      pages.forEach(page=>preview.addPage(page));
      output = Buffer.from(await preview.save());
      res.set('Content-Disposition', `inline; filename="preview-${filename}"`);
    }

    res.set({
      'Content-Type':'application/pdf',
      'Content-Length':String(output.length),
      'Cache-Control':'private, no-store, max-age=0',
      'X-Content-Type-Options':'nosniff'
    });
    return res.status(200).send(output);
  } catch(e) {
    console.error('Academic resource PDF:',e.message);
    return res.status(500).json({error:'Unable to prepare this PDF. Please try again.'});
  }
});


// Student wishlist: saved against the authenticated account (not browser storage).
app.get('/api/wishlist', auth('user'), async (req,res) => {
  try {
    const r = await pool.query(`
      SELECT w.id, w.item_type, w.product_id, w.kit_id, w.created_at,
        CASE WHEN w.item_type='product' THEN p.name ELSE k.name END AS name,
        CASE WHEN w.item_type='product' THEN p.description ELSE k.description END AS description,
        CASE WHEN w.item_type='product' THEN p.image_data ELSE NULL END AS image_data,
        CASE WHEN w.item_type='product' THEN p.price::numeric ELSE
          COALESCE((SELECT SUM(ap.price*aki.quantity) FROM admin_kit_items aki
                    JOIN admin_products ap ON ap.id=aki.product_id WHERE aki.kit_id=k.id),0)::numeric
        END AS price,
        CASE WHEN w.item_type='product' THEN p.product_type ELSE 'Kit' END AS product_type,
        CASE WHEN w.item_type='product' THEN p.academic_year ELSE k.academic_year END AS academic_year,
        CASE WHEN w.item_type='product' THEN p.subject ELSE k.subject END AS subject,
        CASE WHEN w.item_type='product' THEN p.store_group ELSE 'KITS' END AS store_group,
        CASE WHEN w.item_type='product' THEN p.pdf_filename ELSE NULL END AS pdf_filename,
        CASE WHEN w.item_type='product' THEN (p.resource_pdf IS NOT NULL) ELSE FALSE END AS has_pdf
      FROM student_wishlist w
      LEFT JOIN admin_products p ON w.item_type='product' AND p.id=w.product_id AND p.active=true
      LEFT JOIN admin_kits k ON w.item_type='kit' AND k.id=w.kit_id AND k.active=true
      WHERE w.user_id=$1 AND ((w.item_type='product' AND p.id IS NOT NULL) OR (w.item_type='kit' AND k.id IS NOT NULL))
      ORDER BY w.created_at DESC`, [req.auth.userId]);
    res.json({ items: r.rows });
  } catch (e) {
    console.error('Wishlist load:', e.message);
    res.status(500).json({ error: 'Unable to load your wishlist.' });
  }
});

app.post('/api/wishlist', auth('user'), async (req,res) => {
  const itemType = clean(req.body?.item_type || 'product', 20);
  const itemId = Number(req.body?.item_id);
  if (!['product','kit'].includes(itemType) || !Number.isSafeInteger(itemId) || itemId <= 0)
    return res.status(400).json({ error: 'Select a valid product or kit.' });
  try {
    if (itemType === 'product') {
      const p = await pool.query(`SELECT id FROM admin_products WHERE id=$1 AND active=true LIMIT 1`, [itemId]);
      if (!p.rowCount) return res.status(404).json({ error: 'This product is no longer available.' });
      await pool.query(`INSERT INTO student_wishlist(user_id,item_type,product_id) VALUES($1,'product',$2) ON CONFLICT(user_id,product_id) WHERE item_type='product' DO NOTHING`, [req.auth.userId,itemId]);
    } else {
      const k = await pool.query(`SELECT id FROM admin_kits WHERE id=$1 AND active=true LIMIT 1`, [itemId]);
      if (!k.rowCount) return res.status(404).json({ error: 'This kit is no longer available.' });
      await pool.query(`INSERT INTO student_wishlist(user_id,item_type,kit_id) VALUES($1,'kit',$2) ON CONFLICT(user_id,kit_id) WHERE item_type='kit' DO NOTHING`, [req.auth.userId,itemId]);
    }
    res.status(201).json({ ok:true, message:'Added to wishlist.' });
  } catch (e) {
    console.error('Wishlist add:', e.message);
    res.status(500).json({ error:'Unable to save this item.' });
  }
});

app.delete('/api/wishlist/:itemType/:itemId', auth('user'), async (req,res) => {
  const type = clean(req.params.itemType,20), id = Number(req.params.itemId);
  if (!['product','kit'].includes(type) || !Number.isSafeInteger(id) || id<=0)
    return res.status(400).json({error:'Invalid wishlist item.'});
  try {
    await pool.query(`DELETE FROM student_wishlist WHERE user_id=$1 AND item_type=$2 AND
      (($2='product' AND product_id=$3) OR ($2='kit' AND kit_id=$3))`, [req.auth.userId,type,id]);
    res.json({ok:true,message:'Removed from wishlist.'});
  } catch(e) {
    console.error('Wishlist remove:',e.message);
    res.status(500).json({error:'Unable to remove this item.'});
  }
});


// Sell on Cuspilo: authenticated student submissions and listing history.
app.get('/api/sell-on-cuspilo/mine', auth('user'), async (req,res)=>{
  try{
    const r=await pool.query(`SELECT id,product_name,description,years_used,academic_year,subject,asking_price,status,admin_note,created_at,updated_at
      FROM seller_listings WHERE seller_user_id=$1 ORDER BY created_at DESC`,[req.auth.userId]);
    res.json({listings:r.rows});
  }catch(e){console.error('My seller listings:',e.message);res.status(500).json({error:'Unable to load your listings.'});}
});
app.post('/api/sell-on-cuspilo', auth('user'), async (req,res)=>{
  const b=req.body||{}, name=clean(b.product_name,160), description=clean(b.description,3000),
    years=Number(b.years_used), year=clean(b.academic_year,30), subject=clean(b.subject,100),
    price=Number(b.asking_price), image=typeof b.image_data==='string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.image_data) && b.image_data.length<2_700_000 ? b.image_data : '';
  if(!name||!description||!year||!subject||!Number.isFinite(years)||years<0||years>99||!Number.isFinite(price)||price<=0)
    return res.status(400).json({error:'Complete product name, description, years used, academic year, subject and a valid selling price.'});
  try{
    const r=await pool.query(`INSERT INTO seller_listings(seller_user_id,product_name,description,years_used,academic_year,subject,asking_price,image_data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,product_name,status,created_at`,
      [req.auth.userId,name,description,years,year,subject,price,image]);
    res.status(201).json({listing:r.rows[0],message:'Your product has been submitted for admin review.'});
  }catch(e){console.error('Sell on Cuspilo submit:',e.message);res.status(500).json({error:'Unable to submit your listing.'});}
});

app.get('/api/kits', async (req,res)=>{
  try {
    const year=clean(req.query.year,30), subject=clean(req.query.subject,100);
    const r=await pool.query(`SELECT k.*, COALESCE(json_agg(json_build_object('product_id',p.id,'name',p.name,'price',p.price,'quantity',ki.quantity,'image_data',p.image_data,'multi_images',p.multi_images)) FILTER(WHERE p.id IS NOT NULL),'[]'::json) AS items,
      COALESCE(SUM(p.price*ki.quantity),0)::numeric AS total_price
      FROM admin_kits k LEFT JOIN admin_kit_items ki ON ki.kit_id=k.id LEFT JOIN admin_products p ON p.id=ki.product_id AND p.active=true
      WHERE k.active=true AND ($1='' OR k.academic_year IN ('Universal',$1)) AND ($2='' OR k.subject IN ('Universal',$2))
      GROUP BY k.id ORDER BY k.created_at DESC`,[year,subject]);
    res.json({kits:r.rows});
  } catch(e){console.error('Kits:',e.message);res.status(500).json({error:'Unable to load kits.'});}
});

app.get('/api/products/best-sellers',async(_req,res)=>{
  try{
    const r=await pool.query(`SELECT p.id,p.name,p.description,p.image_data,p.multi_images,p.price,p.category,p.subject,p.academic_year,p.product_type,p.store_group,p.search_keywords,p.stock_quantity,p.quality_note,COALESCE(SUM(CASE WHEN o.order_status='DELIVERED' THEN oi.quantity ELSE 0 END),0)::int AS units_sold
      FROM admin_products p LEFT JOIN order_items oi ON oi.product_id=p.id LEFT JOIN orders o ON o.id=oi.order_id AND o.order_status='DELIVERED'
      WHERE p.active=true AND p.product_type='Dental Store' GROUP BY p.id ORDER BY units_sold DESC,p.created_at DESC LIMIT 4`);
    res.json({products:r.rows});
  }catch(e){console.error('Best sellers:',e.message);res.status(500).json({error:'Unable to load best sellers.'});}
});

// Admin invoice PDF download. The invoice is generated from the saved PostgreSQL order,
// not from potentially stale values in the admin table.
app.get('/api/admin/v2/orders/:invoice/invoice.pdf', auth('admin'), async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT id, invoice, customer_name, customer_phone, customer_email, college, address,
              subtotal, total, discount, coupon_code, payment_method, payment_status,
              order_status, created_at
       FROM orders WHERE invoice=$1 LIMIT 1`,
      [req.params.invoice]
    );
    if (!orderResult.rowCount) return res.status(404).json({ error: 'Order not found.' });
    const order = orderResult.rows[0];
    const itemResult = await pool.query(
      `SELECT item_type, item_name, fdi_number, quantity, unit_price, line_total
       FROM order_items WHERE order_id=$1 ORDER BY id ASC`,
      [order.id]
    );

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.10, 0.11, 0.11);
    const muted = rgb(0.40, 0.42, 0.42);
    const copper = rgb(0.68, 0.42, 0.23);
    const mint = rgb(0.66, 0.91, 0.84);
    let page = pdf.addPage([595.28, 841.89]);
    const margin = 48;
    let y = 790;
    const money = value => `INR ${Number(value || 0).toFixed(2)}`;
    const safe = value => String(value ?? '-').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '?');
    const addPage = () => { page = pdf.addPage([595.28, 841.89]); y = 790; };
    const line = (text, opts={}) => {
      const size = opts.size || 10;
      const font = opts.bold ? bold : regular;
      const color = opts.color || ink;
      const maxWidth = opts.maxWidth || 495;
      const words = safe(text).split(/\s+/);
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
          if (y < 65) addPage();
          page.drawText(current, { x: margin, y, size, font, color });
          y -= size + 5;
          current = word;
        } else current = candidate;
      }
      if (current) {
        if (y < 65) addPage();
        page.drawText(current, { x: margin, y, size, font, color });
        y -= size + (opts.gap ?? 5);
      }
    };

    page.drawRectangle({ x: 0, y: 755, width: 595.28, height: 86.89, color: ink });
    page.drawText('CUSPYLO', { x: margin, y: 802, size: 22, font: bold, color: mint });
    page.drawText('ORDER INVOICE', { x: margin, y: 779, size: 10, font: bold, color: rgb(1,1,1) });
    page.drawText(safe(order.invoice), { x: 365, y: 800, size: 11, font: bold, color: rgb(1,1,1) });
    page.drawText(new Date(order.created_at).toLocaleDateString('en-IN'), { x: 365, y: 780, size: 9, font: regular, color: rgb(1,1,1) });
    y = 725;

    line('BILL TO', { bold:true, size:10, color:copper, gap:8 });
    line(order.customer_name, { bold:true, size:13, gap:4 });
    line(`Phone: ${order.customer_phone || '-'}`);
    line(`Email: ${order.customer_email || '-'}`);
    line(`College: ${order.college || '-'}`);
    line(`Delivery address: ${order.address || '-'}`, { maxWidth:495, gap:12 });

    page.drawRectangle({ x:margin, y:y-3, width:499, height:22, color:ink });
    page.drawText('ITEM', { x:margin+8, y:y+4, size:9, font:bold, color:rgb(1,1,1) });
    page.drawText('QTY', { x:390, y:y+4, size:9, font:bold, color:rgb(1,1,1) });
    page.drawText('UNIT', { x:435, y:y+4, size:9, font:bold, color:rgb(1,1,1) });
    page.drawText('TOTAL', { x:490, y:y+4, size:9, font:bold, color:rgb(1,1,1) });
    y -= 28;
    for (const item of itemResult.rows) {
      if (y < 90) addPage();
      const name = safe(item.item_name) + (item.fdi_number ? ` (FDI ${safe(item.fdi_number)})` : '');
      line(name, { size:9, maxWidth:320, gap:0 });
      page.drawText(String(item.quantity), { x:390, y:y+4, size:9, font:regular, color:ink });
      page.drawText(Number(item.unit_price).toFixed(2), { x:435, y:y+4, size:9, font:regular, color:ink });
      page.drawText(Number(item.line_total).toFixed(2), { x:490, y:y+4, size:9, font:regular, color:ink });
      y -= 7;
      page.drawLine({ start:{x:margin,y:y}, end:{x:547,y:y}, thickness:0.5, color:rgb(0.88,0.88,0.88) });
      y -= 13;
    }
    y -= 10;
    const totals = [
      ['Subtotal', money(order.subtotal)],
      ...(Number(order.discount || 0) > 0 ? [[`Discount${order.coupon_code ? ` (${safe(order.coupon_code)})` : ''}`, `- ${money(order.discount)}`]] : []),
      ['Grand total', money(order.total)]
    ];
    for (const [label, value] of totals) {
      if (y < 65) addPage();
      const isGrand = label === 'Grand total';
      page.drawText(label, { x:350, y, size:isGrand?12:10, font:isGrand?bold:regular, color:isGrand?copper:muted });
      page.drawText(value, { x:450, y, size:isGrand?12:10, font:isGrand?bold:regular, color:ink });
      y -= isGrand ? 24 : 18;
    }
    line(`Payment method: ${order.payment_method || 'N/A'}`);
    line(`Payment status: ${order.payment_status || 'N/A'}`);
    line(`Order status: ${order.order_status || 'N/A'}`);
    line('Thank you for shopping with CUSPYLO.', { bold:true, color:copper, gap:0 });

    const bytes = Buffer.from(await pdf.save());
    const filename = `${String(order.invoice).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.status(200).send(bytes);
  } catch (error) {
    console.error('Admin invoice PDF:', error.message);
    return res.status(500).json({ error: 'Unable to generate this invoice. Please try again.' });
  }
});

// Admin-managed order progress with transactional history and audit records.
const ORDER_STATUS = { 'Received':'RECEIVED', 'Packed':'PACKED', 'Out for Delivery':'OUT_FOR_DELIVERY', 'Delivered':'DELIVERED' };
app.patch('/api/admin/v2/orders/:invoice/status', auth('admin'), async (req, res) => {
  const status = clean(req.body?.status, 40);
  const next = ORDER_STATUS[status];
  if (!next) return res.status(400).json({ error: 'Invalid order status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM orders WHERE invoice=$1 FOR UPDATE', [req.params.invoice]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Order not found.' }); }
    const current = found.rows[0].order_status;
    if (found.rows[0].payment_method === 'RAZORPAY_UPI' && found.rows[0].payment_status !== 'PAID') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This order cannot be processed until Razorpay confirms payment.' });
    }
    const steps = ['RECEIVED','PACKED','OUT_FOR_DELIVERY','DELIVERED'];
    if (current === 'CANCELLED' || next === current || steps.indexOf(next) > steps.indexOf(current) + 1) {
      await client.query('ROLLBACK'); return res.status(400).json({ error:'Complete the previous tracking step first.' });
    }
    if (steps.indexOf(next) < 0 || steps.indexOf(next) < steps.indexOf(current)) {
      await client.query('ROLLBACK'); return res.status(400).json({ error:'Use Undo to reverse an order status.' });
    }
    await client.query('UPDATE orders SET order_status=$1, updated_at=NOW() WHERE id=$2', [next, found.rows[0].id]);
    if(next==='DELIVERED'){
      await client.query(`INSERT INTO seller_payouts(seller_listing_id,order_id,seller_user_id,product_amount,commission_amount,seller_amount)
        SELECT (oi.metadata->>'seller_listing_id')::bigint,o.id,sl.seller_user_id,oi.line_total,
          ROUND(oi.line_total*0.20,2),oi.line_total-ROUND(oi.line_total*0.20,2)
        FROM order_items oi JOIN seller_listings sl ON sl.id=(oi.metadata->>'seller_listing_id')::bigint
        JOIN orders o ON o.id=oi.order_id
        WHERE oi.order_id=$1 AND NULLIF(oi.metadata->>'seller_listing_id','') IS NOT NULL
        ON CONFLICT(seller_listing_id,order_id) DO NOTHING`,[found.rows[0].id]);
      await client.query(`UPDATE seller_listings sl SET status='SOLD',updated_at=NOW()
        WHERE EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=$1 AND oi.metadata->>'seller_listing_id'=sl.id::text)`,[found.rows[0].id]);
      await client.query(`UPDATE admin_products SET active=false,updated_at=NOW()
        WHERE seller_listing_id IN (SELECT (oi.metadata->>'seller_listing_id')::bigint FROM order_items oi
          WHERE oi.order_id=$1 AND NULLIF(oi.metadata->>'seller_listing_id','') IS NOT NULL)`,[found.rows[0].id]);
    }
    await client.query(`INSERT INTO order_status_history(order_id,old_status,new_status,note) VALUES($1,$2,$3,$4)`, [found.rows[0].id,current,next,'Updated by admin']);
    await client.query(`INSERT INTO admin_audit_log(action,entity_type,entity_id,details) VALUES($1,'order',$2,$3::jsonb)`, ['ORDER_STATUS_UPDATED', req.params.invoice, JSON.stringify({status:next})]);
    await client.query('COMMIT');
    res.json({ order: { invoice:req.params.invoice, status } });
  } catch(e) { try { await client.query('ROLLBACK'); } catch {} console.error('Order status:',e.message); res.status(500).json({error:'Unable to update order status.'}); }
  finally { client.release(); }
});

app.patch('/api/admin/v2/orders/:invoice/undo', auth('admin'), async (req,res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM orders WHERE invoice=$1 FOR UPDATE', [req.params.invoice]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({error:'Order not found.'}); }
    const history = await client.query('SELECT * FROM order_status_history WHERE order_id=$1 ORDER BY created_at DESC,id DESC FOR UPDATE', [found.rows[0].id]);
    if (history.rowCount <= 1) { await client.query('ROLLBACK'); return res.status(400).json({error:'The order is already at its first step.'}); }
    const latest = history.rows[0];
    const previous = history.rows[1].new_status;
    await client.query('DELETE FROM order_status_history WHERE id=$1', [latest.id]);
    await client.query('UPDATE orders SET order_status=$1,updated_at=NOW() WHERE id=$2', [previous,found.rows[0].id]);
    await client.query(`INSERT INTO admin_audit_log(action,entity_type,entity_id,details) VALUES('ORDER_STATUS_UNDONE','order',$1,$2::jsonb)`, [req.params.invoice,JSON.stringify({status:previous})]);
    await client.query('COMMIT');
    res.json({order:{invoice:req.params.invoice,status:previous}});
  } catch(e) { try { await client.query('ROLLBACK'); } catch {} console.error('Order undo:',e.message); res.status(500).json({error:'Unable to undo order status.'}); }
  finally { client.release(); }
});

// Place order — header, line items and initial tracking event commit atomically.
app.post('/api/orders', auth('user'), async (req, res) => {
  const b=req.body||{}, raw=Array.isArray(b.items)?b.items:[];
  const items=raw.map(x=>({product_id:Number(x.product_id),quantity:Math.max(1,Math.min(99,Math.floor(Number(x.quantity)||1)))})).filter(x=>Number.isSafeInteger(x.product_id)&&x.product_id>0);
  if(!items.length)return res.status(400).json({error:'Your cart is empty.'});
  const merged=new Map(); for(const x of items)merged.set(x.product_id,(merged.get(x.product_id)||0)+x.quantity);
  if([...merged.values()].some(n=>n>99))return res.status(400).json({error:'Maximum quantity per product is 99.'});
  const name=clean(b.name,80),phone=clean(b.phone,20),college=clean(b.college,120),address=clean(b.address,500);
  if(!name||!phone||!college||!address)return res.status(400).json({error:'Name, phone, college and delivery address are required.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const student=await client.query(`SELECT id,academic_year FROM users WHERE id=$1 AND role='user' AND account_status='active'`,[req.auth.userId]);
    if(!student.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Your account is not active.'});}
    const ids=[...merged.keys()];
    const products=await client.query(`SELECT id,name,price,active,stock_quantity,subject,academic_year,product_type,seller_listing_id FROM admin_products WHERE id=ANY($1::bigint[]) FOR UPDATE`,[ids]);
    const byId=new Map(products.rows.map(p=>[Number(p.id),p]));
    if(products.rowCount!==ids.length){await client.query('ROLLBACK');return res.status(400).json({error:'One or more products are no longer available.'});}
    let subtotal=0; const lines=[];
    for(const [id,qty] of merged){const p=byId.get(id);if(!p.active){await client.query('ROLLBACK');return res.status(400).json({error:`${p.name} is unavailable.`});}if((p.seller_listing_id && Number(p.stock_quantity)<qty) || (Number(p.stock_quantity)>0&&Number(p.stock_quantity)<qty)){await client.query('ROLLBACK');return res.status(400).json({error:`Only ${p.stock_quantity} unit(s) of ${p.name} are available.`});}const price=Number(p.price);subtotal+=price*qty;lines.push({p,qty,price});}
    const quote=cartCouponQuote(subtotal,b.coupon_code);
    if(clean(b.coupon_code,60)&&!quote.valid){await client.query('ROLLBACK');return res.status(400).json({error:'That coupon code is not valid. Please apply it again.'});}
    const total=quote.total;
    const invoice='CSP-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
    const method=total===0?'COUPON':'COD',paymentStatus=total===0?'PAID':'PENDING';
    const inserted=await client.query(`INSERT INTO orders(invoice,user_id,customer_name,customer_phone,customer_email,college,address,subtotal,total,payment_method,payment_status,order_status,discount,coupon_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RECEIVED',$12,$13) RETURNING *`,[invoice,student.rows[0].id,name,phone,clean(b.email,120),college,address,subtotal,total,method,paymentStatus,quote.discount,quote.code||null]);
    const order=inserted.rows[0];
    for(const {p,qty,price} of lines){
      await client.query(`INSERT INTO order_items(order_id,item_type,item_name,product_id,quantity,unit_price,line_total,metadata) VALUES($1,'PRODUCT',$2,$3,$4,$5,$6,$7::jsonb)`,[order.id,p.name,p.id,qty,price,price*qty,JSON.stringify({subject:p.subject,academic_year:p.academic_year,product_type:p.product_type,seller_listing_id:p.seller_listing_id||null})]);
      if(Number(p.stock_quantity)>0)await client.query(`UPDATE admin_products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2`,[qty,p.id]);
    }
    await client.query(`INSERT INTO order_status_history(order_id,new_status,note) VALUES($1,'RECEIVED',$2)`,[order.id,total===0?'Order placed; fully covered by coupon':'COD order placed']);
    await client.query('COMMIT');
    res.status(201).json({invoice:order.invoice,name:order.customer_name,phone:order.customer_phone,email:order.customer_email,college:order.college,address:order.address,items:lines.map(x=>({name:x.p.name,quantity:x.qty,price:x.price})),subtotal:Number(order.subtotal),discount:Number(order.discount||0),total:Number(order.total),payment:method==='COUPON'?'Coupon':'COD',paymentStatus:paymentStatus,status:'Received',date:order.created_at,tracking:[{status:'Received',at:order.created_at}]});
  }catch(e){try{await client.query('ROLLBACK')}catch{}console.error('Place order:',e.message);res.status(500).json({error:'Unable to place your order. Please try again.'});}
  finally{client.release();}
});


// Coupon validation and Razorpay checkout. All prices are re-read from PostgreSQL;
// the browser never supplies an authoritative amount.
function cartCouponQuote(subtotal, code) {
  const configuredCode = String(process.env.COUPON_CODE || '').trim();
  const discountValue = Math.max(0, Number(process.env.COUPON_DISCOUNT || 100));
  const submitted = clean(code, 60).toUpperCase();
  const valid = Boolean(configuredCode) && submitted === configuredCode.toUpperCase();
  const discount = valid ? Math.min(Number(subtotal), discountValue) : 0;
  return { valid, code: valid ? configuredCode : '', discount, total: Math.max(0, Number(subtotal) - discount) };
}

async function resolveCart(client, rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : []).map(x => ({
    product_id: Number(x.product_id),
    quantity: Math.max(1, Math.min(99, Math.floor(Number(x.quantity) || 1)))
  })).filter(x => Number.isSafeInteger(x.product_id) && x.product_id > 0);
  if (!items.length) throw new Error('Your cart is empty.');
  const merged = new Map();
  for (const item of items) merged.set(item.product_id, (merged.get(item.product_id) || 0) + item.quantity);
  if ([...merged.values()].some(n => n > 99)) throw new Error('Maximum quantity per product is 99.');
  const ids = [...merged.keys()];
  const result = await client.query(`SELECT id,name,price,active,stock_quantity,subject,academic_year,product_type,seller_listing_id,image_data FROM admin_products WHERE id=ANY($1::bigint[]) FOR UPDATE`, [ids]);
  if (result.rowCount !== ids.length) throw new Error('One or more products are no longer available.');
  const byId = new Map(result.rows.map(p => [Number(p.id), p]));
  let subtotal = 0;
  const lines = [];
  for (const [id, quantity] of merged) {
    const product = byId.get(id);
    if (!product.active) throw new Error(`${product.name} is unavailable.`);
    if ((product.seller_listing_id && Number(product.stock_quantity) < quantity) || (Number(product.stock_quantity) > 0 && Number(product.stock_quantity) < quantity)) throw new Error(`Only ${product.stock_quantity} unit(s) of ${product.name} are available.`);
    const price = Number(product.price);
    subtotal += price * quantity;
    lines.push({ product, quantity, price });
  }
  return { lines, subtotal: Number(subtotal.toFixed(2)) };
}

app.post('/api/coupon/validate', auth('user'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { subtotal } = await resolveCart(client, req.body?.items);
    const quote = cartCouponQuote(subtotal, req.body?.code);
    await client.query('COMMIT');
    if (!quote.valid) return res.status(400).json({ error: 'That coupon code is not valid.' });
    res.json({ code: quote.code, subtotal, discount: quote.discount, total: quote.total });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    res.status(400).json({ error: error.message || 'Unable to validate coupon.' });
  } finally { client.release(); }
});

app.post('/api/payments/razorpay/create', auth('user'), async (req, res) => {
  const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!keyId || !keySecret) return res.status(503).json({ error: 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server .env file.' });
  const b = req.body || {};
  const name = clean(b.name, 80), phone = clean(b.phone, 20), college = clean(b.college, 120), address = clean(b.address, 500), email = clean(b.email, 120);
  if (!name || !phone || !college || !address) return res.status(400).json({ error: 'Name, phone, college and delivery address are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const student = await client.query(`SELECT id FROM users WHERE id=$1 AND role='user' AND account_status='active'`, [req.auth.userId]);
    if (!student.rowCount) throw new Error('Your account is not active.');
    const { lines, subtotal } = await resolveCart(client, b.items);
    const quote = cartCouponQuote(subtotal, b.coupon_code);
    if (clean(b.coupon_code, 60) && !quote.valid) throw new Error('That coupon code is not valid. Please apply it again.');
    const invoice = 'CSP-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const amountPaise = Math.round(quote.total * 100);
    let gatewayOrder = null;
    if (amountPaise > 0) {
      const gatewayResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: invoice, notes: { cuspylo_invoice: invoice, student_id: String(req.auth.userId) } })
      });
      const gatewayData = await gatewayResponse.json().catch(() => ({}));
      if (!gatewayResponse.ok || !gatewayData.id) throw new Error(gatewayData.error?.description || 'Razorpay could not create the payment order.');
      gatewayOrder = gatewayData;
    }
    const paymentStatus = amountPaise > 0 ? 'PENDING' : 'PAID';
    const paymentMethod = amountPaise > 0 ? 'RAZORPAY_UPI' : 'COUPON';
    const inserted = await client.query(`INSERT INTO orders(invoice,user_id,customer_name,customer_phone,customer_email,college,address,subtotal,total,payment_method,payment_status,order_status,discount,coupon_code,razorpay_order_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RECEIVED',$12,$13,$14) RETURNING *`,
      [invoice, student.rows[0].id, name, phone, email, college, address, subtotal, quote.total, paymentMethod, paymentStatus, quote.discount, quote.code || null, gatewayOrder?.id || null]);
    const order = inserted.rows[0];
    for (const { product, quantity, price } of lines) {
      await client.query(`INSERT INTO order_items(order_id,item_type,item_name,product_id,quantity,unit_price,line_total,metadata) VALUES($1,'PRODUCT',$2,$3,$4,$5,$6,$7::jsonb)`,
        [order.id, product.name, product.id, quantity, price, price * quantity, JSON.stringify({ subject: product.subject, academic_year: product.academic_year, product_type: product.product_type, seller_listing_id: product.seller_listing_id || null })]);
      // A fully coupon-covered order is completed without a gateway charge.
      if (amountPaise === 0 && Number(product.stock_quantity) > 0) await client.query(`UPDATE admin_products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2`, [quantity, product.id]);
      // For paid orders, finite stock is decremented only after payment verification.
    }
    await client.query(`INSERT INTO order_status_history(order_id,new_status,note) VALUES($1,'RECEIVED',$2)`, [order.id, amountPaise > 0 ? 'Awaiting Razorpay payment' : 'Coupon covered the full order amount']);
    await client.query('COMMIT');
    if (amountPaise === 0) return res.status(201).json({ free: true, order: { invoice, name, phone, email, college, address, items: lines.map(x => ({ name: x.product.name, quantity: x.quantity, price: x.price })), subtotal, discount: quote.discount, total: 0, payment: 'Coupon', paymentStatus: 'PAID', status: 'Received', date: order.created_at } });
    res.status(201).json({ free: false, keyId, razorpayOrderId: gatewayOrder.id, amount: gatewayOrder.amount, currency: gatewayOrder.currency, invoice, subtotal, discount: quote.discount, total: quote.total, couponCode: quote.code });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Create Razorpay order:', error.message);
    res.status(400).json({ error: error.message || 'Unable to start payment.' });
  } finally { client.release(); }
});

app.post('/api/payments/razorpay/verify', auth('user'), async (req, res) => {
  const secret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!secret) return res.status(503).json({ error: 'Razorpay is not configured.' });
  const b = req.body || {};
  const gatewayOrderId = clean(b.razorpay_order_id, 100);
  const paymentId = clean(b.razorpay_payment_id, 100);
  const signature = clean(b.razorpay_signature, 200);
  if (!gatewayOrderId || !paymentId || !signature) return res.status(400).json({ error: 'Payment verification details are incomplete.' });
  const serverOrder = await pool.query(`SELECT id,razorpay_order_id,total,payment_status FROM orders WHERE razorpay_order_id=$1 AND user_id=$2`, [gatewayOrderId, req.auth.userId]);
  if (!serverOrder.rowCount) return res.status(404).json({ error: 'Payment order not found for this account.' });
  const trustedOrderId = serverOrder.rows[0].razorpay_order_id;
  const expected = crypto.createHmac('sha256', secret).update(`${trustedOrderId}|${paymentId}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return res.status(400).json({ error: 'Razorpay payment signature verification failed.' });
  const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const paymentLookup = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { 'Authorization': 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64') } });
  let paymentInfo = await paymentLookup.json().catch(() => ({}));
  if (!paymentLookup.ok || paymentInfo.order_id !== gatewayOrderId) return res.status(400).json({ error: 'Razorpay could not confirm this payment against the checkout order.' });
  if (paymentInfo.status === 'authorized') {
    const captureResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/capture`, { method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64'), 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: paymentInfo.amount, currency: paymentInfo.currency }) });
    paymentInfo = await captureResponse.json().catch(() => paymentInfo);
    if (!captureResponse.ok) return res.status(409).json({ error: 'Payment is authorised but capture is pending. Please contact CUSPYLO support before retrying.' });
  }
  if (paymentInfo.status !== 'captured') return res.status(400).json({ error: `Payment is not captured yet (status: ${paymentInfo.status || 'unknown'}).` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT * FROM orders WHERE razorpay_order_id=$1 AND user_id=$2 FOR UPDATE`, [gatewayOrderId, req.auth.userId]);
    if (!found.rowCount) throw new Error('Payment order not found for this account.');
    const order = found.rows[0];
    if (Number(paymentInfo.amount) !== Math.round(Number(order.total) * 100) || paymentInfo.currency !== 'INR') throw new Error('Captured payment amount does not match this order. Contact CUSPYLO support.');
    if (order.payment_status === 'PAID') {
      await client.query('COMMIT');
      return res.json({ ok: true, alreadyVerified: true, order: { invoice: order.invoice, total: Number(order.total), payment: 'Razorpay UPI', paymentStatus: 'PAID', status: 'Received' } });
    }
    if (order.payment_status !== 'PENDING') throw new Error('This order is not awaiting payment.');
    const lines = await client.query(`SELECT oi.product_id,oi.quantity,p.name,p.stock_quantity,p.active FROM order_items oi JOIN admin_products p ON p.id=oi.product_id WHERE oi.order_id=$1 FOR UPDATE OF p`, [order.id]);
    for (const line of lines.rows) {
      if (!line.active) throw new Error(`${line.name} is no longer available. Contact CUSPYLO support for payment review.`);
      if (Number(line.stock_quantity) > 0 && Number(line.stock_quantity) < Number(line.quantity)) throw new Error(`${line.name} no longer has enough stock. Contact CUSPYLO support for payment review.`);
    }
    for (const line of lines.rows) if (Number(line.stock_quantity) > 0) await client.query(`UPDATE admin_products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2`, [line.quantity, line.product_id]);
    await client.query(`UPDATE orders SET payment_status='PAID',payment_method='RAZORPAY_UPI',razorpay_payment_id=$1,razorpay_signature=$2,updated_at=NOW() WHERE id=$3`, [paymentId, signature, order.id]);
    await client.query(`INSERT INTO order_status_history(order_id,new_status,note) VALUES($1,'RECEIVED','Razorpay payment verified')`, [order.id]);
    await client.query('COMMIT');
    const items = await pool.query(`SELECT item_name AS name,quantity,unit_price AS price FROM order_items WHERE order_id=$1`, [order.id]);
    res.json({ ok: true, order: { invoice: order.invoice, name: order.customer_name, phone: order.customer_phone, email: order.customer_email, college: order.college, address: order.address, items: items.rows.map(x => ({ ...x, quantity: Number(x.quantity), price: Number(x.price) })), subtotal: Number(order.subtotal), discount: Number(order.discount || 0), total: Number(order.total), payment: 'Razorpay UPI', paymentStatus: 'PAID', status: 'Received', date: order.created_at } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Verify Razorpay payment:', error.message);
    res.status(400).json({ error: error.message || 'Unable to verify payment.' });
  } finally { client.release(); }
});

// Product request — flexible request metadata remains in PostgreSQL JSONB.
app.post('/api/requests', auth('user'), async (req, res) => {
  const b=req.body||{}, product=clean(b.product,160);
  if(!product) return res.status(400).json({error:'Enter the product name.'});
  const image=typeof b.image==='string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.image) && b.image.length<2.5e6 ? b.image : '';
  try {
    await pool.query(`INSERT INTO product_requests(user_id,request_type,customer_name,contact,description,request_data,status)
      VALUES($1,'PRODUCT',$2,$3,$4,$5::jsonb,'PENDING')`,[req.auth.userId,clean(b.name,80),clean(b.phone,20),product,JSON.stringify({product,image})]);
    res.status(201).json({ok:true});
  } catch(e) { console.error('Product request:',e.message); res.status(500).json({error:'Unable to submit product request.'}); }
});

// Feedback is private and visible only in the admin workspace.
app.post('/api/feedback', async (req, res) => {
  const b=req.body||{}, message=clean(b.message,1200);
  if(!message) return res.status(400).json({error:'Please write your feedback.'});
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const payload=verify(token);
  try {
    let userId=null;
    if(payload?.role==='user' && payload.userId) {
      const u=await pool.query(`SELECT id FROM users WHERE id=$1 AND account_status='active'`,[payload.userId]);
      if(u.rowCount) userId=u.rows[0].id;
    }
    let orderId=null, productId=null;
    if (b.order_id && userId) {
      const owned=await pool.query(`SELECT id FROM orders WHERE id=$1 AND user_id=$2`,[b.order_id,userId]);
      if(!owned.rowCount)return res.status(404).json({error:'Order not found.'});
      orderId=owned.rows[0].id;
    }
    if (b.product_id) productId=Number(b.product_id)||null;
    await pool.query(`INSERT INTO feedback(user_id,customer_name,contact,message,order_id,product_id,feedback_type) VALUES($1,$2,$3,$4,$5,$6,$7)`,[userId,clean(b.name,80)||'Anonymous',clean(b.contact,100),message,orderId,productId,orderId?'ORDER_PRIVATE':'GENERAL']);
    res.status(201).json({ok:true});
  } catch(e) { console.error('Feedback:',e.message); res.status(500).json({error:'Unable to submit feedback.'}); }
});


// Public FAQ and Join Us content — only published/available records are exposed.
app.get('/api/faqs', async (_req,res) => {
  res.set('Cache-Control','no-store');
  try {
    const r=await pool.query(`SELECT id,question,answer FROM faqs WHERE published=true ORDER BY sort_order ASC,id ASC`);
    res.json({faqs:r.rows || []});
  } catch(e) { console.error('Public FAQs:',e.message); res.status(500).json({error:'Unable to load FAQs.'}); }
});
app.get('/api/opportunities', async (_req,res) => {
  try {
    const r=await pool.query(`SELECT id,title,description,requirements,location,work_type,application_url
      FROM join_us_opportunities WHERE status='PUBLISHED' ORDER BY created_at DESC`);
    res.json({opportunities:r.rows});
  } catch(e) { console.error('Public opportunities:',e.message); res.status(500).json({error:'Unable to load opportunities.'}); }
});

// Public, moderated reviews for an active catalogue product.
app.get('/api/products/:id/reviews', async (req,res) => {
  try {
    const r=await pool.query(`SELECT pr.id,pr.rating,pr.review_text,pr.created_at,COALESCE(u.name,'CUSPYLO customer') AS reviewer
      FROM product_reviews pr LEFT JOIN users u ON u.id=pr.user_id
      WHERE pr.product_id=$1 AND pr.status='PUBLISHED' ORDER BY pr.created_at DESC`,[req.params.id]);
    res.set('Cache-Control','no-store'); res.json({reviews:r.rows});
  } catch(e) { console.error('Product reviews:',e.message); res.status(500).json({error:'Unable to load product reviews.'}); }
});
app.post('/api/products/:id/reviews', auth('user'), async (req,res) => {
  const rating=Number(req.body?.rating), review=clean(req.body?.review_text,2000), orderId=Number(req.body?.order_id);
  if(!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Choose a rating from 1 to 5.'});
  if(!Number.isInteger(orderId))return res.status(400).json({error:'A delivered order is required to review.'});
  try {
    const owned=await pool.query(`SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=$1 AND o.user_id=$2 AND o.order_status='DELIVERED' AND oi.product_id=$3 LIMIT 1`,[orderId,req.auth.userId,req.params.id]);
    if(!owned.rowCount)return res.status(403).json({error:'Reviews are available only for products in your delivered orders.'});
    const r=await pool.query(`INSERT INTO product_reviews(product_id,user_id,order_id,rating,review_text) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(product_id,user_id,order_id) DO UPDATE SET rating=EXCLUDED.rating,review_text=EXCLUDED.review_text,status='PENDING',updated_at=NOW() RETURNING id,status`,[req.params.id,req.auth.userId,orderId,rating,review]);
    res.status(201).json({review:r.rows[0],message:'Review submitted for admin approval.'});
  } catch(e) { console.error('Submit review:',e.message); res.status(500).json({error:'Unable to submit review.'}); }
});

// Admin overview data is read directly from Neon.
app.get('/api/admin/data', auth('admin'), async (_req, res) => {
  try {
    const [users,orders,requests,feedback]=await Promise.all([
      pool.query(`SELECT id,name,username,phone,email,college,academic_year,pincode,role,created_at FROM users ORDER BY created_at DESC`),
      pool.query(`SELECT o.*,u.username,COALESCE(json_agg(json_build_object('item_type',oi.item_type,'item_name',oi.item_name,'product_id',oi.product_id,'fdi_number',oi.fdi_number,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total)) FILTER(WHERE oi.id IS NOT NULL),'[]'::json) AS line_items,COALESCE((SELECT json_agg(json_build_object('status',h.new_status,'at',h.created_at) ORDER BY h.created_at) FROM order_status_history h WHERE h.order_id=o.id),'[]'::json) AS tracking FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id,u.username ORDER BY o.created_at DESC`),
      pool.query(`SELECT pr.*,u.username,COALESCE(pr.request_data->>'product',pr.description) AS product,COALESCE(pr.request_data->>'image','') AS image,pr.contact AS phone,pr.created_at AS date FROM product_requests pr LEFT JOIN users u ON u.id=pr.user_id ORDER BY pr.created_at DESC`),
      pool.query(`SELECT f.*,f.customer_name AS name,f.created_at AS date FROM feedback f ORDER BY f.created_at DESC`)
    ]);
    res.json({users:users.rows,orders:orders.rows.map(orderForClient),requests:requests.rows.map(r=>({...r,username:r.username||'Deleted user'})),feedback:feedback.rows});
  } catch(e) { console.error('Admin data:',e.message); res.status(500).json({error:'Unable to retrieve admin data.'}); }
});

// Module 02 — all management operations use PostgreSQL.
require('./admin-module')(app, pool, auth);
// Start server

// Admin-managed homepage promotional carousel. Images are stored in PostgreSQL
// so deployments/restarts do not erase published slides.
const ensureHomepagePostsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS homepage_posts (
      id BIGSERIAL PRIMARY KEY,
      position SMALLINT NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 3),
      title VARCHAR(120) NOT NULL DEFAULT '',
      destination VARCHAR(30) NOT NULL CHECK (destination IN ('store','notes','mindmaps')),
      image_data TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

app.get('/api/homepage-posts', async (_req, res) => {
  try {
    await ensureHomepagePostsTable();
    const r = await pool.query(`SELECT position,title,destination,image_data FROM homepage_posts WHERE active=true ORDER BY position ASC`);
    res.json({ slides: r.rows });
  } catch (e) {
    console.error('Homepage posts:', e.message);
    res.status(500).json({ error: 'Unable to load homepage promotions.', slides: [] });
  }
});

app.get('/api/admin/v2/homepage-posts', auth('admin'), async (_req, res) => {
  try {
    await ensureHomepagePostsTable();
    const r = await pool.query(`SELECT position,title,destination,image_data,active,updated_at FROM homepage_posts ORDER BY position ASC`);
    res.json({ slides: r.rows });
  } catch (e) {
    console.error('Admin homepage posts:', e.message);
    res.status(500).json({ error: 'Unable to load homepage promotions.' });
  }
});

app.put('/api/admin/v2/homepage-posts', auth('admin'), async (req, res) => {
  const slides = Array.isArray(req.body?.slides) ? req.body.slides : [];
  if (slides.length !== 3) return res.status(400).json({ error: 'Upload exactly three homepage images.' });
  const destinations = ['store','notes','mindmaps'];
  for (let i=0;i<3;i++) {
    const image = String(slides[i]?.image_data || '');
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(image)) return res.status(400).json({ error: `Image ${i+1} must be PNG, JPG or WebP.` });
    if (image.length > 2_500_000) return res.status(400).json({ error: `Image ${i+1} is too large. Keep each image under 1.8 MB.` });
  }
  const client = await pool.connect();
  try {
    await ensureHomepagePostsTable();
    await client.query('BEGIN');
    for (let i=0;i<3;i++) {
      const title = clean(slides[i]?.title,120) || ['Dental Store','Notes','Mind Maps'][i];
      await client.query(`INSERT INTO homepage_posts(position,title,destination,image_data,active,updated_at)
        VALUES($1,$2,$3,$4,true,NOW())
        ON CONFLICT(position) DO UPDATE SET title=EXCLUDED.title,destination=EXCLUDED.destination,image_data=EXCLUDED.image_data,active=true,updated_at=NOW()`,
        [i+1,title,destinations[i],String(slides[i].image_data)]);
    }
    await client.query('COMMIT');
    res.json({ ok:true, message:'All three homepage promotions published.' });
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('Save homepage posts:',e.message);
    res.status(500).json({ error:'Unable to publish homepage promotions.' });
  } finally { client.release(); }
});

// Keep the frontend fallback AFTER all API routes. Otherwise Express
// serves index.html for /api/homepage-posts and /api/admin/v2/homepage-posts.
app.get('*', (_req, res) => {
  res.sendFile(
    path.join(__dirname, '..', 'frontend', 'index.html')
  );
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`CUSPYLO is running on port ${process.env.PORT || 3000}`);
  console.log('Admin credentials loaded securely.');
});
