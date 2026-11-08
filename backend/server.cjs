
require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const pool = require('./database.cjs');

if (process.env.NODE_ENV === 'production' &&
    (process.env.COOKIE_SECURE !== 'true' || process.env.DB_SSL !== 'true')) {
  throw new Error('Production requires COOKIE_SECURE=true and DB_SSL=true.');
}

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 60 * 60 * 1000;
const COOKIE_NAME = 'kims_session';
const cookieSecure = process.env.COOKIE_SECURE === 'true';
const usernamePattern = /^(?:[a-zA-Z0-9._-]{3,80}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '3mb' }));

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}


function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');

  if (!origin) return next();

  let originUrl;

  try {
    originUrl = new URL(origin);
  } catch {
    return sendError(res, 403, 'Request origin is not allowed.');
  }

  const allowedOrigins = new Set([
    'https://comforting-stardust-b64499.netlify.app',
    'https://kims-smis-backend.onrender.com'
  ]);

  if (
    originUrl.protocol !== 'https:' ||
    !allowedOrigins.has(originUrl.origin)
  ) {
    return sendError(res, 403, 'Request origin is not allowed.');
  }

  return next();
}


app.use('/api', requireSameOrigin);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  return next();
});

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest();
}

async function createAuditLog(client, req, userId, schoolId, action, targetType = '', targetId = null) {
  await client.query(
    `INSERT INTO audit_logs (id, actor_user_id, school_id, action, target_type, target_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(),
      userId || null,
      schoolId || null,
      action,
      targetType,
      targetId,
      req.ip,
      req.get('user-agent') || ''
    ]
  );
}

function publicUser(user) {
  const isOwner = user.account_type === 'system_owner';
  const isSchoolAccount = user.account_type === 'school_account';
  return {
    id: user.id,
    role: isOwner ? 'admin' : isSchoolAccount ? 'school_parent' : 'school',
    userRole: user.account_type,
    schoolId: user.school_id,
    username: user.username,
    name: user.full_name
  };
}

async function authenticate(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || parseCookie(req.get('cookie') || '', COOKIE_NAME);
  if (!token) return sendError(res, 401, 'Sign in is required.');

  try {
    const result = await pool.query(
      `SELECT u.id, u.school_id, u.account_type, u.full_name, u.username, u.status
       FROM user_sessions us
       JOIN users u ON u.id = us.user_id
       WHERE us.token_hash = $1 AND us.revoked_at IS NULL AND us.expires_at > now()`,
      [hashToken(token)]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') {
      return sendError(res, 401, 'Your session is invalid or your account is inactive.');
    }
    req.user = user;
    if (user.account_type !== 'system_owner') {
      const school = await withTenantContext(req, client =>
        client.query('SELECT account_status FROM schools WHERE id=$1', [user.school_id])
      );
      if (!school.rowCount || school.rows[0].account_status !== 'active') {
        return sendError(res, 401, 'Your session is invalid or your account is inactive.');
      }
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function parseCookie(header, name) {
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function requireOwner(req, res, next) {
  if (req.user.account_type !== 'system_owner') {
    return sendError(res, 403, 'System Owner permission is required.');
  }
  return next();
}

async function withTenantContext(req, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.school_id', $1, true),
              set_config('app.is_system_owner', $2, true)`,
      [req.user.school_id || '', String(req.user.account_type === 'system_owner')]
    );
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sanitizeSchoolData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('School data must be an object.');
  }
  const data = structuredClone(input);
  const removeCredentials = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (/^(password|password_hash|token|refresh_token)$/i.test(key)) delete value[key];
      else removeCredentials(value[key]);
    }
  };
  removeCredentials(data);
  delete data.id;
  return data;
}

function validImageDataUrl(value) {
  if (!value) return true;
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return false;
  return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64').byteLength <= 2 * 1024 * 1024;
}

app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return next(error);
  }
});

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many unsuccessful sign-in attempts. Please wait before trying again.' }
});

app.post('/api/auth/register', registrationLimiter, async (req, res, next) => {
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const schoolName = String(body.schoolName || '').trim();
  const district = String(body.district || '').trim();
  const logo = String(body.logoDataUrl || '');
  const paymentMethod = String(body.paymentMethod || 'none');
  const paymentPhone = String(body.paymentPhone || '').trim();
  const paymentAccount = String(body.paymentAccount || '').trim();
  const subscriptionAmount = Number(body.subscriptionAmount || 0);
  const subscribeNow = body.subscribeNow === true;
  if (!usernamePattern.test(username) || password.length < 10 || password.length > 200 ||
      !schoolName || schoolName.length > 200 || !district || district.length > 150 ||
      String(body.address || '').length > 500 || String(body.telephone || '').length > 50 ||
      String(body.email || '').length > 254 || String(body.motto || '').length > 300 ||
      String(body.headTeacher || '').length > 200 ||
      !['none', 'mobile', 'bank'].includes(paymentMethod) ||
      paymentPhone.length > 50 || paymentAccount.length > 100 ||
      (paymentMethod === 'mobile' && !paymentPhone) ||
      (paymentMethod === 'bank' && !paymentAccount) ||
      (subscribeNow && paymentMethod === 'none') ||
      (subscribeNow && (!Number.isFinite(subscriptionAmount) || subscriptionAmount <= 0 || subscriptionAmount > 1000000000))) {
    return sendError(res, 400, 'Enter a valid school, district, username, and a password of at least 10 characters.');
  }
  if (!logo || !validImageDataUrl(logo)) {
    return sendError(res, 400, 'The school logo must be a PNG, JPEG, or WebP image smaller than 2 MB.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.school_id', '', true),
              set_config('app.is_system_owner', 'true', true)`
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const schoolResult = await client.query(
      `INSERT INTO schools (name, district, address, telephone, email, motto, head_teacher, logo_data_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, district, address, telephone, email, motto,
       head_teacher, logo_data_url, account_status, created_at`,
      [
        schoolName,
        district,
        String(body.address || '').trim(),
        String(body.telephone || '').trim(),
        String(body.email || '').trim().toLowerCase(),
        String(body.motto || '').trim(),
        String(body.headTeacher || '').trim(),
        logo
      ]
    );
    const school = schoolResult.rows[0];
    await client.query(
      `SELECT set_config('app.school_id', $1, true),
              set_config('app.is_system_owner', 'false', true)`,
      [school.id]
    );
    const roleIds = {};
    for (const [roleName, description] of [
      ['school_admin', 'School administration'],
      ['subject_teacher', 'Subject teacher'],
      ['class_teacher', 'Class teacher']
    ]) {
     const roleId = crypto.randomUUID();

await client.query(
  `INSERT INTO roles (id, school_id, name, description, is_system_default)
   VALUES ($1, $2, $3, $4, true)`,
  [roleId, school.id, roleName, description]
);

roleIds[roleName] = roleId;
    }
    const rolePermissionMap = {
      school_admin: [
        'register_students', 'enroll_students', 'enter_marks', 'view_marks',
        'manage_grading_scale', 'print_report_cards', 'generate_reports',
        'manage_department_logins', 'manage_staff', 'manage_classes'
      ],
      subject_teacher: ['enter_marks', 'edit_marks'],
      class_teacher: ['enter_marks', 'view_marks', 'compile_marks', 'upload_to_admin']
    };
    for (const [roleName, permissionIds] of Object.entries(rolePermissionMap)) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE id = ANY($2::text[])`,
        [roleIds[roleName], permissionIds]
      );
    }
    const userId = crypto.randomUUID();
const fullName = String(body.headTeacher || schoolName).trim();
const email = String(body.email || '').trim().toLowerCase();

await client.query(
  `INSERT INTO users (
    id, school_id, full_name, username, email, password_hash, account_type
  )
   VALUES ($1, $2, $3, $4, $5, $6, 'school_account')`,
  [
    userId,
    school.id,
    fullName,
    username,
    email,
    passwordHash
  ]
);

const userResult = {
  rows: [{
    id: userId,
    school_id: school.id,
    account_type: 'school_account',
    full_name: fullName
  }]
};
    for (const roleName of ['school_admin', 'subject_teacher', 'class_teacher']) {
      const generatedUsername = `${username.slice(0, 58)}-${roleName.replace('_', '-')}-${crypto.randomBytes(3).toString('hex')}`;
      await client.query(
        `INSERT INTO users (school_id, role_id, full_name, username, password_hash, account_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'suspended')`,
        [
          school.id,
          roleIds[roleName],
          roleName.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
          generatedUsername,
          await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12),
          roleName
        ]
      );
    }
    let payments = [];
    if (subscribeNow) {
      const payment = await client.query(
        const paymentId = crypto.randomUUID();
const paymentNote = 'Initial registration subscription';

await client.query(
  `INSERT INTO payments (
    id, school_id, amount, payment_category, status,
    payment_method, note
  )
   VALUES ($1, $2, $3, 'subscription', 'pending', $4, $5)`,
  [
    paymentId,
    school.id,
    subscriptionAmount,
    paymentMethod,
    paymentNote
  ]
);

const paymentResult = {
  rows: [{
    id: paymentId,
    amount: subscriptionAmount,
    status: 'pending',
    payment_method: paymentMethod,
    note: paymentNote,
    created_at: new Date()
  }]
};
      );
      payments = [{
        id: payment.rows[0].id,
        amount: Number(payment.rows[0].amount),
        status: payment.rows[0].status,
        method: payment.rows[0].payment_method,
        note: payment.rows[0].note,
        date: payment.rows[0].created_at,
        paymentCategory: 'subscription',
        txRef: '',
        notified: false,
        contact: paymentMethod === 'mobile' ? paymentPhone : paymentMethod === 'bank' ? paymentAccount : ''
      }];
    }
    const initialData = {
      staff: [],
      students: [],
      marks: {},
      payments,
      paymentMethod,
      paymentPhone,
      paymentAccount
    };
    await client.query(
      'INSERT INTO school_records (school_id, data) VALUES ($1, $2::jsonb)',
      [school.id, JSON.stringify(initialData)]
    );
    await createAuditLog(client, req, userResult.rows[0].id, school.id, 'school_registered', 'school', school.id);

    await client.query('COMMIT');
    return res.status(201).json({
      user: publicUser(userResult.rows[0]),
      school: {
        id: school.id,
        name: school.name,
        district: school.district,
        address: school.address,
        tel: school.telephone,
        email: school.email,
        motto: school.motto,
        headTeacher: school.head_teacher,
        logoDataUrl: school.logo_data_url,
        username,
        accountStatus: school.account_status,
        staff: [],
        students: [],
        marks: {},
        payments,
        paymentMethod,
        paymentPhone,
        paymentAccount
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return sendError(res, 409, 'That username is already in use.');
    return next(error);
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return sendError(res, 400, 'Username and password are required.');

  try {
    const result = await pool.query(
      `SELECT u.id, u.school_id, u.account_type, u.full_name, u.username, u.password_hash,
              u.status
       FROM users u WHERE lower(u.username) = $1`,
      [username]
    );
    const user = result.rows[0];
    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !validPassword || user.status !== 'active') {
      return sendError(res, 401, 'Invalid credentials or inactive account.');
    }
    if (req.body?.schoolId &&
        (String(user.school_id) !== String(req.body.schoolId) ||
         !['school_admin', 'subject_teacher', 'class_teacher'].includes(user.account_type))) {
      return sendError(res, 401, 'Invalid department credentials for this school.');
    }
    if (user.account_type !== 'system_owner') {
      const schoolStatus = await withTenantContext({ user }, client =>
        client.query('SELECT account_status FROM schools WHERE id=$1', [user.school_id])
      );
      if (!schoolStatus.rowCount || schoolStatus.rows[0].account_status !== 'active') {
        return sendError(res, 401, 'Invalid credentials or inactive account.');
      }
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
await client.query(
  `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
   VALUES ($1, $2, $3, now() + interval '1 hour')`,
  [crypto.randomUUID(), user.id, hashToken(token)]
);

      await client.query(
        'DELETE FROM user_sessions WHERE expires_at < now() OR revoked_at < now() - interval \'30 days\''
      );
      await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await createAuditLog(client, req, user.id, user.school_id, 'user_signed_in', 'user', user.id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.cookie(COOKIE_NAME, token, sessionCookieOptions());
    let school = null;
    if (user.school_id) {
      const schoolResult = await withTenantContext({ user }, client =>
        client.query(
          `SELECT s.id, s.name, s.district, s.address, s.telephone, s.email, s.motto,
                  s.head_teacher, s.logo_data_url, s.account_status, sr.data,
                  sa.id AS school_account_id, sa.full_name AS school_account_name,
                  sa.username, sa.status AS school_account_status
           FROM schools s
           LEFT JOIN school_records sr ON sr.school_id = s.id
           LEFT JOIN users sa ON sa.school_id=s.id AND sa.account_type='school_account'
           WHERE s.id = $1`,
          [user.school_id]
        )
      );
      school = toLegacySchool(schoolResult.rows[0]);
    }
    return res.json({ user: publicUser(user), school });
  } catch (error) {
    return next(error);
  }
});

function toLegacySchool(row) {
  if (!row) return null;
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    name: row.name,
    district: row.district,
    address: row.address,
    tel: row.telephone,
    email: row.email,
    motto: row.motto,
    headTeacher: row.head_teacher,
    logoDataUrl: row.logo_data_url,
    accountStatus: row.account_status,
    schoolAccount: row.school_account_id ? {
      id: row.school_account_id,
      accountType: 'school_account',
      name: row.school_account_name,
      username: row.username,
      status: row.school_account_status
    } : null,
    users: row.users || data.users || []
  };
}

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/logout', authenticate, async (req, res, next) => {
  const token = parseCookie(req.get('cookie') || '', COOKIE_NAME);
  try {
    await pool.query(
      'UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hashToken(token)]
    );
    res.clearCookie(COOKIE_NAME, { ...sessionCookieOptions(), maxAge: undefined });
    return res.json({ status: 'ok' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/credentials', authenticate, async (req, res, next) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newUsername = String(req.body?.username || '').trim().toLowerCase();
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || (!newUsername && !newPassword)) {
    return sendError(res, 400, 'Enter your current password and at least one new credential.');
  }
  if (newUsername && !usernamePattern.test(newUsername)) {
    return sendError(res, 400, 'Enter a valid username or email address.');
  }
  if (newPassword && (newPassword.length < 10 || newPassword.length > 200)) {
    return sendError(res, 400, 'New passwords must contain at least 10 characters.');
  }
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!result.rowCount || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
      return sendError(res, 401, 'Current password is incorrect.');
    }
    const token = parseCookie(req.get('cookie') || '', COOKIE_NAME);
    const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : null;
    await pool.query(
      `UPDATE users SET username=COALESCE($2, username),
       password_hash=COALESCE($3, password_hash), updated_at=now() WHERE id=$1`,
      [req.user.id, newUsername || null, passwordHash]
    );
    await pool.query(
      'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL',
      [req.user.id, hashToken(token)]
    );
    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, school_id, action, target_type, target_id, ip_address, user_agent)
       VALUES ($1,$2,'credentials_updated','user',$1,$3,$4)`,
      [req.user.id, req.user.school_id, req.ip, req.get('user-agent') || '']
    );
    return res.json({ username: newUsername || req.user.username });
  } catch (error) {
    if (error.code === '23505') return sendError(res, 409, 'That username is already in use.');
    return next(error);
  }
});

app.post('/api/auth/heartbeat', authenticate, async (req, res, next) => {
  const token = parseCookie(req.get('cookie') || '', COOKIE_NAME);
  try {
    const result = await pool.query(
      `UPDATE user_sessions SET expires_at=now() + interval '1 hour'
       WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    if (!result.rowCount) return sendError(res, 401, 'Your session has expired.');
    res.cookie(COOKIE_NAME, token, sessionCookieOptions());
    return res.json({ status: 'ok' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/restore-school', authenticate, async (req, res, next) => {
  if (!req.user.school_id || req.user.account_type === 'school_account') {
    return sendError(res, 400, 'There is no school account session to restore.');
  }
  try {
    const result = await pool.query(
      `SELECT id, school_id, account_type, full_name, username
       FROM users WHERE school_id=$1 AND account_type='school_account' AND status='active'`,
      [req.user.school_id]
    );
    const schoolAccount = result.rows[0];
    if (!schoolAccount) return sendError(res, 404, 'The school account could not be found.');
    const token = crypto.randomBytes(32).toString('base64url');
    
await pool.query(
  `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
   VALUES ($1, $2, $3, now() + interval '1 hour')`,
  [crypto.randomUUID(), schoolAccount.id, hashToken(token)]
);

    const currentToken = parseCookie(req.get('cookie') || '', COOKIE_NAME);
    await pool.query(
      'UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
      [hashToken(currentToken)]
    );
    res.cookie(COOKIE_NAME, token, sessionCookieOptions());
    return res.json({ user: publicUser(schoolAccount) });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/schools/admin-setup', authenticate, async (req, res, next) => {
  if (req.user.account_type !== 'school_account' || !req.user.school_id) {
    return sendError(res, 403, 'Sign in with the school registration account to set up its first administrator.');
  }
  try {
    const result = await withTenantContext(req, client =>
      client.query(
        `SELECT status FROM users
         WHERE school_id=$1 AND account_type='school_admin'
         ORDER BY created_at LIMIT 1`,
        [req.user.school_id]
      )
    );
    return res.json({
      required: !result.rowCount || result.rows[0].status === 'suspended'
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/schools/admin-setup', authenticate, async (req, res, next) => {
  const schoolId = String(req.user.school_id || '');
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (req.user.account_type !== 'school_account' || !schoolId) {
    return sendError(res, 403, 'Sign in with the school registration account to set up its first administrator.');
  }
  if (!usernamePattern.test(username)) {
    return sendError(res, 400, 'Enter a valid administrator username or email address.');
  }
  if (password.length < 10 || password.length > 200) {
    return sendError(res, 400, 'Administrator passwords must contain at least 10 characters.');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  try {
    const user = await withTenantContext(req, async client => {
      const current = await client.query(
        `SELECT id, status FROM users
         WHERE school_id=$1 AND account_type='school_admin'
         ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [schoolId]
      );
      if (current.rowCount && current.rows[0].status !== 'suspended') {
        return { alreadyConfigured: true };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      let updated;
      if (current.rowCount) {
        await client.query(
  `UPDATE users
   SET username=$2, password_hash=$3, status='active', updated_at=NOW()
   WHERE id=$1`,
  [current.rows[0].id, username, passwordHash]
);

updated = await client.query(
  `SELECT id, school_id, account_type, full_name, username
   FROM users
   WHERE id=$1`,
  [current.rows[0].id]
);
      } else {
        const role = await client.query(
          `SELECT id FROM roles WHERE school_id=$1 AND name='school_admin' LIMIT 1`,
          [schoolId]
        );
        if (!role.rowCount) throw new Error('The school administrator role is not configured.');
        updated = await client.query(
          `INSERT INTO users (school_id, role_id, full_name, username, password_hash, account_type, status)
           VALUES ($1, $2, 'School Administrator', $3, $4, 'school_admin', 'active')
           RETURNING id, school_id, account_type, full_name, username`,
          [schoolId, role.rows[0].id, username, passwordHash]
        );
      }

     await client.query(
  `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
   VALUES ($1, $2, $3, now() + interval '1 hour')`,
  [crypto.randomUUID(), updated.rows[0].id, hashToken(token)]
);
      const currentToken = parseCookie(req.get('cookie') || '', COOKIE_NAME);
      if (currentToken) {
        await client.query(
          `UPDATE user_sessions SET revoked_at=now()
           WHERE token_hash=$1 AND revoked_at IS NULL`,
          [hashToken(currentToken)]
        );
      }
      await createAuditLog(
        client,
        req,
        req.user.id,
        schoolId,
        'first_school_admin_setup',
        'user',
        updated.rows[0].id
      );
      return updated.rows[0];
    });
    if (user.alreadyConfigured) {
      return sendError(res, 409, 'The school administrator login has already been set up.');
    }

    res.cookie(COOKIE_NAME, token, sessionCookieOptions());
    return res.json({
      user: {
        id: user.id,
        schoolId: user.school_id,
        role: 'school',
        userRole: user.account_type,
        username: user.username,
        name: user.full_name
      }
    });
  } catch (error) {
    if (error.code === '23505') return sendError(res, 409, 'That username is already in use.');
    return next(error);
  }
});

app.get('/api/schools', authenticate, async (req, res, next) => {
  try {
    const rows = await withTenantContext(req, client => {
      if (req.user.account_type === 'system_owner') {
        return client.query(
          `SELECT s.id, s.name, s.district, s.address, s.telephone, s.email, s.motto,
                  s.head_teacher, s.logo_data_url, s.account_status, sr.data,
                  u.id AS school_account_id, u.full_name AS school_account_name,
                  u.username, u.status AS school_account_status,
                  COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'id', cu.id, 'name', cu.full_name, 'username', cu.username,
                      'role', cu.account_type, 'accountType', cu.account_type, 'status', cu.status
                    ) ORDER BY cu.account_type)
                    FROM users cu WHERE cu.school_id=s.id
                      AND cu.account_type IN ('school_admin', 'subject_teacher', 'class_teacher')
                  ), '[]'::jsonb) AS users
           FROM schools s LEFT JOIN school_records sr ON sr.school_id = s.id
           LEFT JOIN users u ON u.school_id = s.id AND u.account_type = 'school_account'
           ORDER BY s.name`
        );
      }
      return client.query(
        `SELECT s.id, s.name, s.district, s.address, s.telephone, s.email, s.motto,
                s.head_teacher, s.logo_data_url, s.account_status, sr.data,
                u.id AS school_account_id, u.full_name AS school_account_name,
                u.username, u.status AS school_account_status,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', cu.id, 'name', cu.full_name, 'username', cu.username,
                    'role', cu.account_type, 'accountType', cu.account_type, 'status', cu.status
                  ) ORDER BY cu.account_type)
                  FROM users cu WHERE cu.school_id=s.id
                    AND cu.account_type IN ('school_admin', 'subject_teacher', 'class_teacher')
                ), '[]'::jsonb) AS users
         FROM schools s LEFT JOIN school_records sr ON sr.school_id = s.id
         LEFT JOIN users u ON u.school_id = s.id AND u.id = $2 AND u.account_type = 'school_account'
         WHERE s.id = $1`,
        [req.user.school_id, req.user.id]
      );
    });
    return res.json(rows.rows.map(row => ({ ...toLegacySchool(row), username: row.username })));
  } catch (error) {
    return next(error);
  }
});

app.put('/api/schools/:schoolId/users/:userId/password', authenticate, async (req, res, next) => {
  const schoolId = req.params.schoolId;
  const currentUsername = String(req.body?.currentUsername || '').trim().toLowerCase();
  const newPassword = String(req.body?.newPassword || '');
  if (!currentUsername) {
    return sendError(res, 400, 'Enter the account current username.');
  }
  if (newPassword.length < 10 || newPassword.length > 200) {
    return sendError(res, 400, 'Passwords must contain at least 10 characters.');
  }
  if (!['school_account', 'school_admin'].includes(req.user.account_type) ||
      String(req.user.school_id) !== schoolId) {
    return sendError(res, 403, 'School administrator permission is required.');
  }

  try {
    const result = await withTenantContext(req, async client => {
      const actor = await client.query(
        `SELECT u.account_type,
                EXISTS (
                  SELECT 1 FROM role_permissions rp
                  JOIN permissions p ON p.id=rp.permission_id
                  WHERE rp.role_id=u.role_id AND p.id='manage_department_logins'
                ) AS can_manage_department_logins
         FROM users u WHERE u.id=$1 AND u.school_id=$2`,
        [req.user.id, schoolId]
      );
      if (!actor.rowCount ||
          (actor.rows[0].account_type === 'school_admin' && !actor.rows[0].can_manage_department_logins)) {
        return { forbidden: true };
      }

      const target = await client.query(
        `SELECT id, school_id, account_type, username
         FROM users
         WHERE id=$1 AND school_id=$2
           AND account_type IN ('school_admin', 'subject_teacher', 'class_teacher')`,
        [req.params.userId, schoolId]
      );
      if (!target.rowCount) return { notFound: true };
      if (String(target.rows[0].username).trim().toLowerCase() !== currentUsername) {
        return { usernameMismatch: true };
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      const updated = await client.query(
        `UPDATE users SET password_hash=$2,
         status=CASE WHEN status='suspended' THEN 'active' ELSE status END,
         updated_at=now()
         WHERE id=$1
         RETURNING id, school_id, account_type, full_name, username, status`,
        [target.rows[0].id, passwordHash]
      );
      const token = parseCookie(req.get('cookie') || '', COOKIE_NAME);
      await client.query(
        `UPDATE user_sessions SET revoked_at=now()
         WHERE user_id=$1 AND revoked_at IS NULL AND token_hash<>$2`,
        [target.rows[0].id, hashToken(token || '')]
      );
      await createAuditLog(
        client,
        req,
        req.user.id,
        schoolId,
        'department_password_reset',
        'user',
        target.rows[0].id
      );
      return { user: updated.rows[0] };
    });
    if (result.forbidden) return sendError(res, 403, 'Your role cannot manage department logins.');
    if (result.notFound) return sendError(res, 404, 'The selected department account could not be found.');
    if (result.usernameMismatch) return sendError(res, 401, 'The current username does not match this account.');

    const user = result.user;
    return res.json({
      user: {
        id: user.id,
        schoolId: user.school_id,
        accountType: user.account_type,
        name: user.full_name,
        username: user.username,
        status: user.status
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/schools/:schoolId/users/:userId/credentials', authenticate, requireOwner, async (req, res, next) => {
  const currentUsername = String(req.body?.currentUsername || '').trim().toLowerCase();
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!currentUsername) {
    return sendError(res, 400, 'Enter the selected account current username.');
  }
  if (!usernamePattern.test(username)) {
    return sendError(res, 400, 'Enter a valid username or email address.');
  }
  if (password.length < 10 || password.length > 200) {
    return sendError(res, 400, 'Passwords must contain at least 10 characters.');
  }

  try {
    const user = await withTenantContext(req, async client => {
      const current = await client.query(
        `SELECT id, school_id, account_type, full_name, status, username
         FROM users
         WHERE id=$1 AND school_id=$2
           AND account_type IN ('school_account', 'school_admin', 'subject_teacher', 'class_teacher')`,
        [req.params.userId, req.params.schoolId]
      );
      if (!current.rowCount) return null;
      if (String(current.rows[0].username).trim().toLowerCase() !== currentUsername) {
        return { usernameMismatch: true };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const updated = await client.query(
        `UPDATE users
         SET username=$2, password_hash=$3,
             status=CASE WHEN status='suspended' THEN 'active' ELSE status END,
             updated_at=now()
         WHERE id=$1
         RETURNING id, school_id, account_type, full_name, username, status`,
        [current.rows[0].id, username, passwordHash]
      );
      await client.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [current.rows[0].id]
      );
      await createAuditLog(
        client,
        req,
        req.user.id,
        current.rows[0].school_id,
        'user_credentials_reset',
        'user',
        current.rows[0].id
      );
      return { user: updated.rows[0] };
    });
    if (!user) return sendError(res, 404, 'The selected school user account could not be found.');
    if (user.usernameMismatch) {
      return sendError(res, 401, 'The current username does not match the selected account.');
    }
    const updatedUser = user.user;
    return res.json({
      user: {
        id: updatedUser.id,
        schoolId: updatedUser.school_id,
        accountType: updatedUser.account_type,
        name: updatedUser.full_name,
        username: updatedUser.username,
        status: updatedUser.status
      }
    });
  } catch (error) {
    if (error.code === '23505') return sendError(res, 409, 'That username is already in use.');
    return next(error);
  }
});

app.put('/api/schools/:id', authenticate, async (req, res, next) => {
  const schoolId = req.params.id;
  const isOwner = req.user.account_type === 'system_owner';
  if (!isOwner && !['school_account', 'school_admin'].includes(req.user.account_type)) {
    return sendError(res, 403, 'School administrator permission is required.');
  }
  if (!isOwner && String(req.user.school_id) !== schoolId) {
    return sendError(res, 403, 'You can only update your own school records.');
  }
  const submittedSchool = req.body || {};
  const submittedUsers = Array.isArray(submittedSchool.users) ? submittedSchool.users : [];
  let data;
  try {
    data = sanitizeSchoolData(submittedSchool);
  } catch (error) {
    return sendError(res, 400, error.message);
  }

  try {
    const result = await withTenantContext(req, async client => {
      const current = await client.query('SELECT id, account_status FROM schools WHERE id = $1', [schoolId]);
      if (!current.rowCount) return null;
      const profile = {
        name: String(data.name || '').trim(),
        district: String(data.district || '').trim(),
        address: String(data.address || '').trim(),
        telephone: String(data.tel || '').trim(),
        email: String(data.email || '').trim().toLowerCase(),
        motto: String(data.motto || '').trim(),
        headTeacher: String(data.headTeacher || '').trim(),
        logoDataUrl: String(data.logoDataUrl || '')
      };
      if (!profile.name || !profile.district) throw new TypeError('School name and district are required.');
      if (profile.name.length > 200 || profile.district.length > 150 ||
          profile.address.length > 500 || profile.telephone.length > 50 ||
          profile.email.length > 254 || profile.motto.length > 300 ||
          profile.headTeacher.length > 200 || !validImageDataUrl(profile.logoDataUrl)) {
        throw new TypeError('School profile fields are invalid or exceed their allowed lengths.');
      }
      if (data.accountStatus !== undefined) {
        if (!['active', 'suspended', 'blocked'].includes(data.accountStatus)) {
          throw new TypeError('Choose a valid school account status.');
        }
        if (!isOwner && data.accountStatus !== current.rows[0].account_status) {
          throw new TypeError('Only the System Owner can set a valid school account status.');
        }
        if (isOwner && data.accountStatus !== current.rows[0].account_status) {
          await client.query('UPDATE schools SET account_status=$2 WHERE id=$1', [schoolId, data.accountStatus]);
        }
      }
      await client.query(
        `UPDATE schools SET name=$2, district=$3, address=$4, telephone=$5, email=$6,
         motto=$7, head_teacher=$8, logo_data_url=$9, updated_at=now() WHERE id=$1`,
        [schoolId, profile.name, profile.district, profile.address, profile.telephone,
          profile.email, profile.motto, profile.headTeacher, profile.logoDataUrl]
      );
      await client.query(
        `UPDATE users SET email=$2, full_name=$3, updated_at=now()
         WHERE school_id=$1 AND account_type='school_account'`,
        [schoolId, profile.email, profile.headTeacher || profile.name]
      );
      if (data.username !== undefined) {
        const normalizedUsername = String(data.username).trim().toLowerCase();
        if (!usernamePattern.test(normalizedUsername)) {
          throw new TypeError('Username must be 3-80 letters, numbers, dots, underscores, or hyphens.');
        }
        await client.query(
          `UPDATE users SET username=$2, updated_at=now()
           WHERE school_id=$1 AND account_type='school_account'`,
          [schoolId, normalizedUsername]
        );
      }
      if (submittedSchool.password) {
        const password = String(submittedSchool.password);
        if (password.length < 10 || password.length > 200) {
          throw new TypeError('Passwords must contain at least 10 characters.');
        }
        await client.query(
          `UPDATE users SET password_hash=$2, updated_at=now()
           WHERE school_id=$1 AND account_type='school_account'`,
          [schoolId, await bcrypt.hash(password, 12)]
        );
      }
      if (isOwner) for (const account of submittedUsers) {
        const accountType = String(account.accountType || account.role || '');
        if (!['school_admin', 'subject_teacher', 'class_teacher'].includes(accountType)) continue;
        const accountUsername = String(account.username || '').trim().toLowerCase();
        const fullName = String(account.name || account.fullName || '').trim();
        if (!usernamePattern.test(accountUsername) || !fullName || fullName.length > 200) {
          throw new TypeError('Department accounts need a valid username and full name.');
        }
        let accountResult = null;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(account.id || ''))) {
          accountResult = await client.query(
            'SELECT id FROM users WHERE id=$1 AND school_id=$2 AND account_type=$3',
            [account.id, schoolId, accountType]
          );
        }
        if (!accountResult?.rowCount) {
          accountResult = await client.query(
            `SELECT id FROM users WHERE school_id=$1 AND account_type=$2 ORDER BY created_at LIMIT 1`,
            [schoolId, accountType]
          );
        }
        const newPassword = String(account.password || '');
        if (!accountResult?.rowCount) {
          if (!newPassword) continue;
          if (newPassword.length < 10 || newPassword.length > 200) {
            throw new TypeError('Department account passwords must contain at least 10 characters.');
          }
          const roleResult = await client.query(
            'SELECT id FROM roles WHERE school_id=$1 AND name=$2',
            [schoolId, accountType]
          );
          if (!roleResult.rowCount) throw new TypeError('The selected department role is unavailable.');
          await client.query(
            `INSERT INTO users (school_id, role_id, full_name, username, password_hash, account_type, status)
             VALUES ($1,$2,$3,$4,$5,$6,'active')`,
            [schoolId, roleResult.rows[0].id, fullName, accountUsername, await bcrypt.hash(newPassword, 12), accountType]
          );
          continue;
        }
        if (newPassword) {
          if (newPassword.length < 10 || newPassword.length > 200) {
            throw new TypeError('Department account passwords must contain at least 10 characters.');
          }
          await client.query(
            `UPDATE users SET username=$2, full_name=$3, password_hash=$4, status='active', updated_at=now()
             WHERE id=$1`,
            [accountResult.rows[0].id, accountUsername, fullName, await bcrypt.hash(newPassword, 12)]
          );
        } else {
          await client.query(
            'UPDATE users SET username=$2, full_name=$3, updated_at=now() WHERE id=$1',
            [accountResult.rows[0].id, accountUsername, fullName]
          );
        }
      }
      await client.query(
        `INSERT INTO school_records (school_id, data, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (school_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
        [schoolId, JSON.stringify(data)]
      );
      await createAuditLog(client, req, req.user.id, schoolId, 'school_records_updated', 'school', schoolId);
      return profile;
    });
    if (!result) return sendError(res, 404, 'School account not found.');
    return res.json({ status: 'ok' });
  } catch (error) {
    if (error instanceof TypeError) return sendError(res, 400, error.message);
    if (error.code === '23505') return sendError(res, 409, 'That username is already in use.');
    return next(error);
  }
});

app.delete('/api/schools/:id', authenticate, requireOwner, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.school_id', '', true),
              set_config('app.is_system_owner', 'true', true)`
    );
    const school = await client.query('SELECT id, name FROM schools WHERE id=$1', [req.params.id]);
    if (!school.rowCount) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'School account not found.');
    }
    await createAuditLog(client, req, req.user.id, req.params.id, 'school_deleted', 'school', req.params.id);
    await client.query(
      `DELETE FROM support_ticket_replies r
       USING support_tickets t
       WHERE r.ticket_id=t.id AND t.school_id=$1`,
      [req.params.id]
    );
    await client.query('DELETE FROM support_tickets WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM marks WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM report_cards WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM students WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM school_classes WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM terms WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM subjects WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM academic_years WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM school_subscriptions WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM payments WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM school_records WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM users WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM roles WHERE school_id=$1', [req.params.id]);
    await client.query('DELETE FROM schools WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

app.use(express.static(path.resolve(__dirname, '..'), {
  dotfiles: 'ignore',
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.use((error, req, res, next) => {
  console.error('Unhandled request error:', error);
  if (res.headersSent) return next(error);
  return sendError(res, 500, 'The request could not be completed.');
});

async function start() {
  await pool.query('SELECT 1');
  app.listen(PORT, () => console.log(`KIMS server listening on port ${PORT}`));
}

if (require.main === module) {
  start().catch(error => {
    console.error('Could not start KIMS server:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, pool, sanitizeSchoolData };
