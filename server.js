const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const argon2 = require('argon2');
const { 
  generateRegistrationOptions, 
  verifyRegistrationResponse, 
  generateAuthenticationOptions, 
  verifyAuthenticationResponse 
} = require('@simplewebauthn/server');

// ---- Sanctuary RP Config ----
const RP_ID = '7ay.de';
const RP_NAME = '7ay.de Sanctuary';
const ORIGIN = `https://${RP_ID}`;

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/opt/organizer/data/organizer.db';

// SEC-16: allowed domain values
const VALID_DOMAINS = ['CTI', 'ECM', 'CSD', 'GRA', 'Personal'];

// ---- Session secret (generated once, persisted to disk) ----
const SECRET_PATH = '/opt/organizer/data/.session_secret';
let SESSION_SECRET;
try {
  SESSION_SECRET = fs.readFileSync(SECRET_PATH, 'utf-8').trim();
} catch {
  SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_PATH, SESSION_SECRET, { mode: 0o600 });
}

// ---- DB ----
const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrate: task_events audit log (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS task_events (
    id      INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action  TEXT NOT NULL,
    detail  TEXT,
    ts      TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_events_user ON task_events(user_id, ts);
`);

// ---- Session helpers ----
function parseSid(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function signSession(slug) {
  const ts = Date.now().toString(36);
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(slug + ':' + ts).digest('hex');
  return `${slug}.${ts}.${hmac}`;
}

function verifySession(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [slug, ts, hmac] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(slug + ':' + ts).digest('hex');
  if (!hmac || !expected || hmac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  // 30-day expiry
  const age = Date.now() - parseInt(ts, 36);
  if (age > 30 * 24 * 60 * 60 * 1000) return null;
  return slug;
}

function getSessionUser(req) {
  const token = parseSid(req.headers.cookie);
  const slug = verifySession(token);
  if (!slug) return null;
  return db.prepare('SELECT * FROM users WHERE slug = ?').get(slug) || null;
}

// ---- task_events helper ----
function logTaskEvent(taskId, userId, action, detail = null) {
  db.prepare('INSERT INTO task_events (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)')
    .run(taskId, userId, action, detail ? JSON.stringify(detail) : null);
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// SEC-17: security headers
app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://www.transparenttextures.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---- Login / Logout (public — before auth middleware) ----
const LOGIN_HTML = (nonce, error = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#090a0f">
<title>organizer | gateway</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/simplewebauthn-browser/9.0.0/index.umd.min.js"></script>
<style nonce="${nonce}">
  @import url('https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@100..900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:'Lexend Deca',sans-serif; background-color:#090a0f; color:#f4f0ea;
    height:100vh; width:100vw; display:flex; align-items:center; justify-content:center;
    overflow:hidden;
    background-image: 
      radial-gradient(at 0% 0%, rgba(30,36,44,0.5) 0, transparent 50%),
      radial-gradient(at 100% 100%, rgba(232,176,4,0.08) 0, transparent 40%),
      linear-gradient(180deg, #121416 0%, #050608 100%);
  }
  .bg-text{
    position:absolute;top:10%;left:5%;font-size:25vh;font-weight:900;
    text-transform:uppercase;color:rgba(255,255,255,0.02);
    letter-spacing:-15px;line-height:0.8;pointer-events:none;z-index:0;
  }
  .monolith{
    position:relative;z-index:1;
    background:linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
    backdrop-filter:blur(50px);-webkit-backdrop-filter:blur(50px);
    border:1px solid rgba(255,255,255,0.1);
    padding:80px;width:90%;max-width:550px;
    box-shadow:0 60px 120px rgba(0,0,0,0.8);
    display:flex;flex-direction:column;gap:40px;
    transform: perspective(1000px) rotateY(-5deg) rotateX(2deg);
  }
  .monolith::before{
    content:"";position:absolute;inset:0;
    background:radial-gradient(circle at 100% 0%, rgba(232,176,4,0.1) 0%, transparent 50%);
    pointer-events:none;
  }
  h1{font-size:40px;font-weight:900;letter-spacing:-2px;text-transform:lowercase;color:#f4f0ea;margin-bottom:0}
  h1 span{color:#e8b004;opacity:0.8}

  .field{display:flex;flex-direction:column;gap:12px;position:relative}
  label{font-size:10px;font-weight:900;text-transform:uppercase;color:rgba(244,240,234,0.3);letter-spacing:4px}
  input{
    width:100%;padding:20px;background:rgba(0,0,0,0.2);
    border:1px solid rgba(255,255,255,0.05);
    color:#f4f0ea;font-size:18px;outline:none;font-family:inherit;
    box-shadow:inset 4px 4px 10px rgba(0,0,0,0.5);
    transition:all 0.3s;
  }
  input:focus{border-color:#e8b004;background:rgba(0,0,0,0.3);box-shadow:inset 4px 4px 10px rgba(0,0,0,0.6), 0 0 20px rgba(232,176,4,0.1)}

  button{
    padding:22px;background:#e8b004;color:#000;border:none;
    font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:3px;
    cursor:pointer;transition:all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
    box-shadow:0 15px 30px rgba(232, 176, 4, 0.2);
  }
  button:hover{filter:brightness(1.1);transform:translateY(-4px);box-shadow:0 25px 50px rgba(232, 176, 4, 0.4)}
  button:active{transform:translateY(2px);box-shadow:inset 0 4px 10px rgba(0,0,0,0.4)}

  .passkey-btn{background:rgba(255,255,255,0.05);color:#f4f0ea;border:1px solid rgba(255,255,255,0.1);margin-top:-10px}
  .passkey-btn:hover{background:rgba(255,255,255,0.1);border-color:#e8b004}

  .err{color:#ff8888;font-size:13px;font-weight:600;background:rgba(255,85,85,0.05);border-left:4px solid #ff8888;padding:15px;letter-spacing:0.5px}

  @keyframes breathe {
    0%,100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.1); }
  }
  .fog{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 70%);animation:breathe 10s infinite ease-in-out;pointer-events:none}
</style>
</head>
<body>
<div class="bg-text">sanctuary</div>
<div class="fog"></div>
<div class="monolith">
  <h1>organizer<span>.</span></h1>
  <form id="loginForm" style="display:flex;flex-direction:column;gap:30px">
    <div id="errorBox"></div>
    <div class="field">
      <label>Identity</label>
      <input id="slug" name="slug" placeholder="username" autocomplete="username" required autofocus>
    </div>
    <button type="submit" id="unlockBtn">Unlock Sanctuary</button>
  </form>
</div>
<script nonce="${nonce}">
  const { startAuthentication, startRegistration } = SimpleWebAuthnBrowser;
  const form = document.getElementById('loginForm');
  const slugInput = document.getElementById('slug');
  const errorBox = document.getElementById('errorBox');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const slug = slugInput.value.trim();
    if (!slug) return;
    errorBox.innerHTML = '';

    try {
      // 1. Check if user exists and has passkeys
      const optsResp = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug })
      });
      const opts = await optsResp.json();

      if (optsResp.status === 404) {
        errorBox.innerHTML = '<p class="err">Identity not found in sanctuary.</p>';
        return;
      }

      if (opts.allowCredentials && opts.allowCredentials.length > 0) {
        // AUTHENTICATION FLOW
        const asseResp = await startAuthentication(opts);
        const verifyResp = await fetch('/api/auth/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, response: asseResp })
        });
        const verif = await verifyResp.json();
        if (verif.ok) location.href = '/' + slug;
        else errorBox.innerHTML = '<p class="err">Verification failed.</p>';
      } else {
        // REGISTRATION FLOW (Trust on first use for existing user without passkey)
        if (confirm('No passkey found for this identity. Register this device?')) {
          const regOptsResp = await fetch('/api/auth/register-options-public', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug })
          });
          const regOpts = await regOptsResp.json();
          const attResp = await startRegistration(regOpts);
          const verifyResp = await fetch('/api/auth/register-verify-public', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, response: attResp })
          });
          const verif = await verifyResp.json();
          if (verif.ok) location.href = '/' + slug;
          else errorBox.innerHTML = '<p class="err">Registration failed.</p>';
        }
      }
    } catch (err) {
      console.error(err);
      errorBox.innerHTML = '<p class="err">' + err.message + '</p>';
    }
  };
</script>
</body>
</html>`;

app.get('/login', (req, res) => {
  if (getSessionUser(req)) return res.redirect('/');
  res.send(LOGIN_HTML(res.locals.nonce));
});

app.get('/logout', (req, res) => {
  res.clearCookie('sid');
  res.redirect('/login');
});

// ---- Auth Middleware ----
const ensureAuth = (req, res, next) => {
  const user = getSessionUser(req);
  if (!user) {
    if (req.xhr || req.path.startsWith('/api')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/login');
  }
  req.user = user;
  next();
};

// ---- WebAuthn (Passkeys) Endpoints ----

function setChallenge(userId, challenge) {
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 mins
  db.prepare('INSERT OR REPLACE INTO auth_challenges (user_id, challenge, expires_at) VALUES (?, ?, ?)')
    .run(userId, challenge, expiresAt);
}

function getChallenge(userId) {
  const row = db.prepare('SELECT challenge FROM auth_challenges WHERE user_id = ? AND expires_at > ?')
    .get(userId, Math.floor(Date.now() / 1000));
  return row ? row.challenge : null;
}

// Public registration options (for existing users with 0 passkeys)
app.post('/api/auth/register-options-public', async (req, res) => {
  const { slug } = req.body;
  const user = db.prepare('SELECT id, slug FROM users WHERE slug = ?').get(slug);
  if (!user) return res.status(404).json({ error: 'user not found' });
  
  const count = db.prepare('SELECT count(*) as count FROM credentials WHERE user_id = ?').get(user.id).count;
  if (count > 0) return res.status(403).json({ error: 'passkeys already registered, use login flow' });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(String(user.id)),
    userName: user.slug,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  setChallenge(user.id, options.challenge);
  res.json(options);
});

app.post('/api/auth/register-verify-public', async (req, res) => {
  const { slug, response } = req.body;
  const user = db.prepare('SELECT id, slug FROM users WHERE slug = ?').get(slug);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const count = db.prepare('SELECT count(*) as count FROM credentials WHERE user_id = ?').get(user.id).count;
  if (count > 0) return res.status(403).json({ error: 'forbidden' });

  const expectedChallenge = getChallenge(user.id);
  if (!expectedChallenge) return res.status(400).json({ error: 'challenge expired' });

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
      db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)')
        .run(credentialID, user.id, Buffer.from(credentialPublicKey), counter, JSON.stringify(response.response.transports || []));
      
      const token = signSession(slug);
      res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; Path=/; Max-Age=${30*24*3600}; HttpOnly; Secure; SameSite=Strict`);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'verification failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/register-options', ensureAuth, async (req, res) => {
  const user = req.user;
  const userCredentials = db.prepare('SELECT id FROM credentials WHERE user_id = ?').all(user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(String(user.id)),
    userName: user.slug,
    attestationType: 'none',
    excludeCredentials: userCredentials.map(cred => ({
      id: cred.id,
      type: 'public-key',
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  setChallenge(user.id, options.challenge);
  res.json(options);
});

app.post('/api/auth/register-verify', ensureAuth, async (req, res) => {
  const user = req.user;
  const expectedChallenge = getChallenge(user.id);
  if (!expectedChallenge) return res.status(400).json({ error: 'challenge expired' });

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
      db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)')
        .run(credentialID, user.id, Buffer.from(credentialPublicKey), counter, JSON.stringify(req.body.response.transports || []));
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'verification failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login-options', async (req, res) => {
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const user = db.prepare('SELECT id FROM users WHERE slug = ?').get(slug);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const userCredentials = db.prepare('SELECT id, transports FROM credentials WHERE user_id = ?').all(user.id);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: userCredentials.map(cred => ({
      id: cred.id,
      type: 'public-key',
      transports: JSON.parse(cred.transports || '[]'),
    })),
    userVerification: 'preferred',
  });

  setChallenge(user.id, options.challenge);
  res.json(options);
});

app.post('/api/auth/login-verify', async (req, res) => {
  const { slug, response } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE slug = ?').get(slug);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const expectedChallenge = getChallenge(user.id);
  if (!expectedChallenge) return res.status(400).json({ error: 'challenge expired' });

  const cred = db.prepare('SELECT public_key, counter FROM credentials WHERE id = ? AND user_id = ?').get(response.id, user.id);
  if (!cred) return res.status(400).json({ error: 'credential not found' });

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID: response.id,
        credentialPublicKey: new Uint8Array(cred.public_key),
        counter: cred.counter,
      },
    });

    if (verification.verified) {
      db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(verification.authenticationInfo.newCounter, response.id);
      const token = signSession(slug);
      res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; Path=/; Max-Age=${30*24*3600}; HttpOnly; Secure; SameSite=Strict`);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'verification failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ---- SPA ----
app.get('/:slug', ensureAuth, (req, res) => {
  if (req.params.slug.startsWith('api')) return res.status(404).end();
  const filePath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return res.status(500).end();
    const html = data.replace(/<style>/g, `<style nonce="${res.locals.nonce}">`);
    res.send(html);
  });
});

// ---- API: Tasks helper ----
function getTasksForUser(userId, archived = false) {
  const archVal = archived ? 1 : 0;
  const rows = db.prepare(`
    SELECT t.*, 
      COALESCE(
        json_group_array(
          CASE 
            WHEN s.id IS NOT NULL 
            THEN json_object('id',s.id,'label',s.label,'done',s.done,'sort_order',s.sort_order,'task_id',s.task_id)
          END
        ) FILTER (WHERE s.id IS NOT NULL), '[]') AS subs_json,
      COALESCE(json_group_array(b.blocked_by) FILTER (WHERE b.blocked_by IS NOT NULL), '[]') AS needs_json
    FROM tasks t
    LEFT JOIN subtasks s ON s.task_id = t.id
    LEFT JOIN blockers b ON b.task_id = t.id
    WHERE t.user_id = ? AND t.archived = ?
    GROUP BY t.id
    ORDER BY t.sort_order
  `).all(userId, archVal);
  return rows.map(r => {
    const { subs_json, needs_json, ...task } = r;
    task.subs = JSON.parse(subs_json);
    task.needs = JSON.parse(needs_json);
    return task;
  });
}

// SEC-1: ownership check helpers
function requireTaskOwner(req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) { res.status(404).json({ error: 'not found' }); return null; }
  if (task.user_id !== req.user.id) { res.status(403).json({ error: 'forbidden' }); return null; }
  return task;
}

function requireSubtaskOwner(req, res) {
  const sub = db.prepare(`
    SELECT s.*, t.user_id FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?
  `).get(req.params.id);
  if (!sub) { res.status(404).json({ error: 'not found' }); return null; }
  if (sub.user_id !== req.user.id) { res.status(403).json({ error: 'forbidden' }); return null; }
  return sub;
}

// ---- Root ----
app.get('/', ensureAuth, (req, res) => {
  res.redirect('/' + req.user.slug);
});

// ---- API: Users ----
app.get('/api/users', ensureAuth, (req, res) => {
  res.json({ users: db.prepare('SELECT id, name, slug FROM users ORDER BY id').all() });
});

// ---- UI State ----
app.get('/api/users/:slug/ui-state', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const row = db.prepare('SELECT value FROM ui_state WHERE key = ?').get(req.user.id + ':state');
  res.json(row ? JSON.parse(row.value) : {});
});

app.put('/api/users/:slug/ui-state', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  db.prepare('INSERT OR REPLACE INTO ui_state (key, value) VALUES (?, ?)').run(req.user.id + ':state', JSON.stringify(req.body));
  res.json({ ok: true });
});

// ---- API: Tasks (user-scoped) ----
app.get('/api/users/:slug/tasks', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  res.json({ tasks: getTasksForUser(req.user.id, req.query.view === 'archived'), user: req.user });
});

app.post('/api/users/:slug/tasks', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const { domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, needs, subs } = req.body;
  // SEC-16: validate domain
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (domain && !VALID_DOMAINS.includes(domain)) return res.status(400).json({ error: 'invalid domain' });
  // Input length validation
  if (name.length > 500) return res.status(400).json({ error: 'name too long (max 500)' });
  if (plan_label && plan_label.length > 100) return res.status(400).json({ error: 'plan_label too long (max 100)' });
  if (due_label && due_label.length > 100) return res.status(400).json({ error: 'due_label too long (max 100)' });
  if (subs?.some(s => typeof s === 'string' && s.length > 500)) return res.status(400).json({ error: 'subtask label too long (max 500)' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as max_sort_order FROM tasks WHERE user_id = ?').get(req.user.id);
  const taskId = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO tasks (user_id, domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(req.user.id, domain, name, plan_date || null, due_date || null, plan_label || '', due_label || '', speed || 0, stakes || 0, maxOrder.max_sort_order + 1);
    const id = r.lastInsertRowid;
    if (needs?.length) {
      const ins = db.prepare('INSERT INTO blockers (task_id, blocked_by) VALUES (?, ?)');
      for (const n of needs) ins.run(id, n);
    }
    if (subs?.length) {
      const ins = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)');
      subs.forEach((s, i) => ins.run(id, s, i + 1));
    }
    return id;
  })();
  logTaskEvent(taskId, req.user.id, 'created', { domain, name });
  res.json({ ok: true, id: taskId });
});

// ---- API: Tasks (by id) ----
app.patch('/api/tasks/:id', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  // SEC-16: validate domain if present
  if (req.body.domain && !VALID_DOMAINS.includes(req.body.domain)) return res.status(400).json({ error: 'invalid domain' });
  // Input length validation
  if (req.body.name && req.body.name.length > 500) return res.status(400).json({ error: 'name too long (max 500)' });
  if (req.body.plan_label && req.body.plan_label.length > 100) return res.status(400).json({ error: 'plan_label too long (max 100)' });
  if (req.body.due_label && req.body.due_label.length > 100) return res.status(400).json({ error: 'due_label too long (max 100)' });
  
  // DEDUP: done is archived, archived is done
  if (req.body.done !== undefined) req.body.archived = req.body.done;

  // SEC: fields is a hardcoded allowlist — f is never user-supplied, no SQL injection risk
  const fields = ['domain','name','plan_date','due_date','plan_label','due_label','speed','stakes','sort_order','done','archived'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/toggle', ensureAuth, (req, res) => {
  const task = requireTaskOwner(req, res);
  if (!task) return;
  const done = task.done ? 0 : 1;
  // DEDUP: toggle both
  db.prepare("UPDATE tasks SET done = ?, archived = ?, archived_at = ?, updated_at = datetime('now') WHERE id = ?")
    .run(done, done, done ? db.prepare("SELECT datetime('now')").get()['datetime(\'now\')'] : null, task.id);
  logTaskEvent(task.id, req.user.id, done ? 'done' : 'undone');
  res.json({ ok: true, done: !!done });
});

app.patch('/api/tasks/:id/archive', ensureAuth, (req, res) => {
  const task = requireTaskOwner(req, res);
  if (!task) return;
  // DEDUP: archive is done
  db.prepare("UPDATE tasks SET archived = 1, done = 1, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logTaskEvent(task.id, req.user.id, 'archived');
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/unarchive', ensureAuth, (req, res) => {
  const task = requireTaskOwner(req, res);
  if (!task) return;
  // DEDUP: unarchive is not done
  db.prepare("UPDATE tasks SET archived = 0, done = 0, archived_at = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logTaskEvent(task.id, req.user.id, 'unarchived');
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- API: Subtasks ----
app.post('/api/tasks/:id/subtasks', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  if (label.length > 500) return res.status(400).json({ error: 'label too long (max 500)' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as max_sort_order FROM subtasks WHERE task_id = ?').get(req.params.id);
  const r = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)').run(req.params.id, label, maxOrder.max_sort_order + 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.patch('/api/subtasks/:id/toggle', ensureAuth, (req, res) => {
  const sub = requireSubtaskOwner(req, res);
  if (!sub) return;
  const done = sub.done ? 0 : 1;
  db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(done, sub.id);
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(sub.task_id);
  res.json({ ok: true, done: !!done });
});

app.patch('/api/subtasks/:id', ensureAuth, (req, res) => {
  if (!requireSubtaskOwner(req, res)) return;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  if (label.length > 500) return res.status(400).json({ error: 'label too long (max 500)' });
  db.prepare('UPDATE subtasks SET label = ? WHERE id = ?').run(label, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/subtasks/:id', ensureAuth, (req, res) => {
  if (!requireSubtaskOwner(req, res)) return;
  db.prepare('DELETE FROM subtasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- API: Blockers ----
app.post('/api/blockers', ensureAuth, (req, res) => {
  const { task_id, blocked_by } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.prepare('INSERT OR IGNORE INTO blockers (task_id, blocked_by) VALUES (?, ?)').run(task_id, blocked_by);
  res.json({ ok: true });
});

app.delete('/api/blockers', ensureAuth, (req, res) => {
  const { task_id, blocked_by } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM blockers WHERE task_id = ? AND blocked_by = ?').run(task_id, blocked_by);
  res.json({ ok: true });
});

// ---- Agent Proxy ----
app.post('/api/agent/gemini', ensureAuth, async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  if (question.length > 2000) return res.status(400).json({ error: 'question too long' });

  const user = req.user;
  const tasks = getTasksForUser(user.id);
  const events = db.prepare('SELECT * FROM task_events WHERE user_id = ? AND ts > datetime(\'now\', \'-30 days\') ORDER BY ts DESC LIMIT 100').all(user.id);

  const prompt = `You are a scheduling assistant for ${user.name}.
Current tasks: ${JSON.stringify(tasks)}
Recent events: ${JSON.stringify(events)}
User question: ${question}`;

  try {
    const spawnRes = spawnSync('/opt/organizer/repo/scripts/gemini-ask.sh', [prompt], {
      encoding: 'utf-8',
      timeout: 90000,
    });
    if (spawnRes.status !== 0) {
      console.error('Gemini error:', spawnRes.stderr);
      return res.status(500).json({ error: 'Oracle unreachable' });
    }
    res.json({ answer: spawnRes.stdout.trim() });
  } catch (e) {
    console.error('Gemini agent error:', e.message);
    res.status(500).json({ error: 'gemini request failed' });
  }
});

// SEC-11: bind to localhost only — nginx handles external traffic
app.listen(PORT, '127.0.0.1', () => console.log(`Organizer running on 127.0.0.1:${PORT}`));
