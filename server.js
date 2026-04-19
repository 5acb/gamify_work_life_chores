const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
// ── Gemini Direct Invoke ─────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = 'gemini-2.5-pro';

async function geminiInvoke(prompt, systemPrompt = '', history = [], timeout = 90000) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const contents = [];
  for (const h of history) contents.push({ role: h.role, parts: [{ text: h.text }] });
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  const body = { contents };
  if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
    return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  } finally { clearTimeout(timer); }
}


const fs = require('fs');
const argon2 = require('argon2');
const { 
  generateRegistrationOptions, 
  verifyRegistrationResponse, 
  generateAuthenticationOptions, 
  verifyAuthenticationResponse 
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

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
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://www.transparenttextures.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com`);
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
    transition: all 0.5s ease-in-out;
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

  .secondary-btn{background:rgba(255,255,255,0.05);color:#f4f0ea;border:1px solid rgba(255,255,255,0.1);margin-top:-10px}
  .secondary-btn:hover{background:rgba(255,255,255,0.1);border-color:#e8b004}

  .err{color:#ff8888;font-size:13px;font-weight:600;background:rgba(255,85,85,0.05);border-left:4px solid #ff8888;padding:15px;letter-spacing:0.5px}

  @keyframes breathe {
    0%,100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.1); }
  }
  .fog{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 70%);animation:breathe 10s infinite ease-in-out;pointer-events:none}
  
  .enroll-view{display:none;flex-direction:column;gap:30px}
  .enroll-view h2{font-size:24px;font-weight:800;letter-spacing:-1px;color:#e8b004}
  .enroll-view p{font-size:14px;opacity:0.6;line-height:1.6}
</style>
</head>
<body>
<div class="bg-text">sanctuary</div>
<div class="fog"></div>
<div class="monolith">
  <div id="loginView" style="display:flex;flex-direction:column;gap:40px">
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
  
  <div id="enrollView" class="enroll-view">
    <h2>Secure this Identity?</h2>
    <p>No biometric key found for this identity in the sanctuary. Use your device's fingerprint or face scanner to create a permanent, passwordless link.</p>
    <button id="confirmEnroll">Register this Device</button>
    <button id="cancelEnroll" class="secondary-btn">Cancel</button>
  </div>
</div>

<script nonce="${nonce}">
  const { startAuthentication, startRegistration } = SimpleWebAuthnBrowser;
  const loginForm = document.getElementById('loginForm');
  const slugInput = document.getElementById('slug');
  const errorBox = document.getElementById('errorBox');
  const loginView = document.getElementById('loginView');
  const enrollView = document.getElementById('enrollView');
  
  let currentSlug = '';

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    currentSlug = slugInput.value.trim();
    if (!currentSlug) return;
    errorBox.innerHTML = '';

    try {
      const optsResp = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: currentSlug })
      });
      const opts = await optsResp.json();

      if (optsResp.status === 404) {
        errorBox.innerHTML = '<p class="err">Identity not found in sanctuary.</p>';
        return;
      }

      if (opts.allowCredentials && opts.allowCredentials.length > 0) {
        const asseResp = await startAuthentication(opts);
        const verifyResp = await fetch('/api/auth/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: currentSlug, response: asseResp })
        });
        const verif = await verifyResp.json();
        if (verif.ok) location.href = '/' + currentSlug;
        else errorBox.innerHTML = '<p class="err">Verification failed.</p>';
      } else {
        loginView.style.display = 'none';
        enrollView.style.display = 'flex';
      }
    } catch (err) {
      console.error(err);
      errorBox.innerHTML = '<p class="err">' + err.message + '</p>';
    }
  };

  document.getElementById('cancelEnroll').onclick = () => {
    enrollView.style.display = 'none';
    loginView.style.display = 'flex';
    errorBox.innerHTML = '';
  };

  document.getElementById('confirmEnroll').onclick = async () => {
    try {
      const regOptsResp = await fetch('/api/auth/register-options-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: currentSlug })
      });
      const regOpts = await regOptsResp.json();
      const attResp = await startRegistration(regOpts);
      const verifyResp = await fetch('/api/auth/register-verify-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: currentSlug, response: attResp })
      });
      const verif = await verifyResp.json();
      if (verif.ok) location.href = '/' + currentSlug;
      else alert('Registration failed.');
    } catch (err) {
      console.error(err);
      alert(err.message);
      document.getElementById('cancelEnroll').click();
    }
  };
</script>
</body>
</html>`;

// ── Potato test user (dev/render testing) ──
(function seedPotatoUser(){
  let u = db.prepare('SELECT id FROM users WHERE slug=?').get('potato');
  if (!u) {
    const r = db.prepare("INSERT INTO users(name,slug) VALUES('Potato','potato')").run();
    u = { id: r.lastInsertRowid };
    console.log('[seed] potato user created id='+u.id);
    const now = new Date().toISOString().split('T')[0];
    [
      { name:'Write lit review intro', domain:'GRA', due_date: now },
      { name:'Review ICS firmware logs', domain:'CTI', due_date: null },
      { name:'Prep council slides', domain:'ECM', due_date: null },
    ].forEach(t => {
      db.prepare("INSERT INTO tasks(user_id,name,domain,due_date) VALUES(?,?,?,?)").run(u.id,t.name,t.domain,t.due_date);
    });
  }
})();

// Dev-only: issue a session for potato (headless render tests)
app.get('/api/dev/potato', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();
  const token = signSession('potato');
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict`);
  res.json({ ok: true, slug: 'potato' });
});

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
    userID: Uint8Array.from(String(user.id), c => c.charCodeAt(0)),
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
      const info = verification.registrationInfo;
      const finalID = info.credentialID || (info.credential && info.credential.id);
      const finalPubKey = info.credentialPublicKey || (info.credential && info.credential.publicKey);
      const finalCounter = info.counter !== undefined ? info.counter : (info.credential && info.credential.counter);

      if (!finalPubKey || !finalID) {
        console.error('Registration Handshake Failed - Missing Data. Info:', JSON.stringify(info));
        throw new Error('Incomplete registration info');
      }

      const idStr = (finalID instanceof Uint8Array) ? isoBase64URL.fromUint8Array(finalID) : finalID;
      const pubKeyBuffer = Buffer.from(finalPubKey);

      db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)')
        .run(idStr, user.id, pubKeyBuffer, finalCounter || 0, JSON.stringify(response.response.transports || []));
      
      const token = signSession(slug);
      res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; Path=/; Max-Age=${30*24*3600}; HttpOnly; Secure; SameSite=Strict`);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'verification failed' });
    }
  } catch (err) {
    console.error('Registration Verify Error:', err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login-options', async (req, res) => {
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const user = db.prepare('SELECT id, slug FROM users WHERE slug = ?').get(slug);
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
  const user = db.prepare('SELECT id, slug FROM users WHERE slug = ?').get(slug);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const expectedChallenge = getChallenge(user.id);
  if (!expectedChallenge) {
    console.error('Login Verify Error: Challenge expired for user', user.id);
    return res.status(400).json({ error: 'challenge expired' });
  }

  const cred = db.prepare('SELECT public_key, counter FROM credentials WHERE id = ? AND user_id = ?').get(response.id, user.id);
  if (!cred) {
    console.error('Login Verify Error: Credential not found in DB:', response.id);
    return res.status(400).json({ error: 'credential not found' });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(cred.public_key),
        counter: cred.counter || 0,
      },
    });

    if (verification.verified) {
      const info = verification.authenticationInfo;
      const newCounter = info ? info.newCounter : (verification.counter !== undefined ? verification.counter : cred.counter);
      
      db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(newCounter, response.id);
      const token = signSession(slug);
      res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; Path=/; Max-Age=${30*24*3600}; HttpOnly; Secure; SameSite=Strict`);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'verification failed' });
    }
  } catch (err) {
    console.error('Login Verify Exception:', err);
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
  logTaskEvent(task.id, req.user.id, 'unarchive');
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
const geminiCache    = new Map();  // key -> { answer, ts }
const geminiInFlight = new Map();  // key -> Promise (dedup concurrent identical)
const GEMINI_CACHE_TTL = 30000;    // 30s

function geminiCacheKey(uid, q) {
  return uid + ':' + q.trim().toLowerCase().replace(/\s+/g, ' ');
}

app.post('/api/agent/gemini', ensureAuth, async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  if (question.length > 2000) return res.status(400).json({ error: 'question too long' });

  const key = geminiCacheKey(req.user.id, question);

  // Cache hit (30s TTL)
  const cached = geminiCache.get(key);
  if (cached && Date.now() - cached.ts < GEMINI_CACHE_TTL)
    return res.json({ answer: cached.answer, cached: true });

  // Dedup identical concurrent requests
  if (geminiInFlight.has(key)) {
    try { return res.json({ answer: await geminiInFlight.get(key), cached: true }); }
    catch { return res.status(500).json({ error: 'Oracle unreachable' }); }
  }

  const tasks = getTasksForUser(req.user.id);
  const prompt = `You are a scheduling assistant for ${req.user.name}.
Current tasks: ${JSON.stringify(tasks)}
User question: ${question}`;

  const inflight = new Promise((resolve, reject) => {
    try {
      const r = spawnSync('/opt/organizer/repo/scripts/gemini-ask.sh', [prompt], {
        encoding: 'utf-8', timeout: 90000,
      });
      if (r.status !== 0) return reject(new Error(r.stderr));
      resolve(r.stdout.trim());
    } catch (e) { reject(e); }
  });

  geminiInFlight.set(key, inflight);
  try {
    const answer = await inflight;
    geminiCache.set(key, { answer, ts: Date.now() });
    res.json({ answer });
  } catch (e) {
    console.error('Gemini agent error:', e.message);
    res.status(500).json({ error: 'Oracle unreachable' });
  } finally {
    geminiInFlight.delete(key);
  }
});
// SEC-11: bind to localhost only — nginx handles external traffic

// ── Task context builder ─────────────────────────────────────
function buildTaskContext(userId) {
  const tasks = getTasksForUser(userId);
  const events = db.prepare(
    "SELECT action, detail, ts FROM task_events WHERE user_id=? AND ts > datetime('now','-14 days') ORDER BY ts DESC LIMIT 50"
  ).all(userId);
  const today = new Date().toISOString().split('T')[0];
  const summary = tasks.map(t => {
    const daysUntilDue = t.due_date
      ? Math.round((new Date(t.due_date) - new Date()) / 86400000)
      : null;
    return {
      id: t.id, name: t.name, domain: t.domain,
      plan_date: t.plan_date, due_date: t.due_date,
      daysUntilDue, speed: t.speed, stakes: t.stakes,
      done: t.done, archived: t.archived,
      blocked: t.needs?.length > 0,
      blockedBy: t.needs || [],
      subtaskCount: t.subs?.length || 0,
      subtasksDone: t.subs?.filter(s => s.done).length || 0
    };
  });
  return { tasks: summary, events, today, totalActive: tasks.filter(t => !t.archived).length };
}

// ── Plan Sessions API ──────────────────────────────────────────
// ── Council Chamber API ─────────────────────────────────────
const COUNCIL_PERSONAS = {
  strategist: {
    name: 'Strategist',
    system: `You are a senior productivity strategist embedded in a personal task manager called the Atmospheric Sanctuary. You have access to the user's full task state and recent history.
Your role: determine what should be prioritised and why, identify the critical path, and help the user sequence their work for maximum progress.
Be direct. Give concrete recommendations. Reference specific tasks by name. Think in terms of dependencies, deadlines, and cognitive load.
Keep responses concise — 3-5 sentences unless asked to elaborate.`
  },
  risk_scout: {
    name: 'Risk Scout',
    system: `You are a risk analyst embedded in a personal task manager called the Atmospheric Sanctuary. You have access to the user's full task state and recent history.
Your role: identify what could go wrong. Spot deadline risks, dependency chains that could cascade, tasks that are underestimated, and blockers that haven't been resolved.
Be specific and honest — name the tasks, name the risks. Don't soften concerns.
Keep responses concise — 3-5 sentences unless asked to elaborate.`
  },
  psychologist: {
    name: 'Psychologist',
    system: `You are a cognitive psychologist embedded in a personal task manager called the Atmospheric Sanctuary. You have access to the user's full task state and recent history.
Your role: monitor cognitive load, stress signals, and sustainable pacing. Flag when the task stack looks overwhelming. Notice patterns — tasks that keep slipping, domains being neglected, urgency clusters building up.
Speak plainly. Be warm but honest.
Keep responses concise — 3-5 sentences unless asked to elaborate.`
  },
  domain_expert: {
    name: 'Domain Expert',
    system: `You are a domain specialist embedded in a personal task manager called the Atmospheric Sanctuary. Your expertise adapts to the domain in focus.
For CTI tasks: you are a Cybersecurity Threat Intelligence analyst — you know MITRE ATT&CK, intelligence requirements, dark web analysis, structured analytic techniques.
For CSD tasks: you are a Drone/Embedded Systems Security researcher — you know MAVLink, ArduPilot, firmware RE, attack surface analysis.
For ECM tasks: you are an Enterprise Security Management consultant — you know governance frameworks, risk management, incident response, compliance.
For GRA tasks: you are an Academic Research Advisor — you know the Dragos/ICS security landscape, academic writing, research methodology, publication strategy.
For Personal tasks: you are a Life and Productivity Coach — practical, grounded, non-judgmental.
Adapt your voice to the domain in focus. Be specific and knowledgeable.
Keep responses concise — 3-5 sentences unless asked to elaborate.`
  },
  plan_oracle: {
    name: 'Plan Oracle',
    system: `You are the Plan Oracle — a composite intelligence embedded in a personal task manager called the Atmospheric Sanctuary. You hold three simultaneous perspectives and switch between them fluidly.

DEVIL'S ADVOCATE: Challenge the framing itself. Ask whether tasks should exist at all. Identify self-imposed deadlines masquerading as real ones. Surface assumptions nobody has questioned. You are the only voice allowed to say "drop this entirely."

TIMEKEEPER: Do the hard calendar arithmetic. Given the task list and urgency levels, calculate whether the plan is physically possible. Name exact conflicts: "3 Canyon tasks in 48 hours is 14 hours of work in 9 available hours — something must be cut." Force concrete trade-off decisions.

INTEGRATOR: See across all domains simultaneously. Find hidden connections between tasks, resource conflicts where two deadlines require the same cognitive mode on the same day, and portfolio-level incoherence. No other agent has this cross-domain view.

Lead with whichever lens is most urgent. Be direct, specific, willing to say the uncomfortable thing.
Keep responses to 4-6 sentences unless asked to elaborate.`
  },
  moderator: {
    name: 'Moderator',
    system: `You are the Council Moderator for the Atmospheric Sanctuary — a personal task manager. You chair a council of four specialist agents: Strategist, Risk Scout, Psychologist, and Plan Oracle (or Domain Expert when a specific task is in focus).

Your role:
1. SYNTHESIZE: You receive briefings from all four agents. Read them, find the signal, strip the noise, and present a coherent picture to the user. When multiple agents flag the same issue, mention it once with more weight, not twice.
2. GUIDE: Walk the user through the most important items one by one. Don't dump everything at once. Start with the single most urgent thing, resolve it or get a decision, then move to the next.
3. MODERATE: When the user has a question that requires a specialist's depth, tell them to switch to that agent directly. You manage the overall session arc.
4. DECIDE: Push for concrete decisions. "Do you want to defer this or drop it?" is better than "you might consider whether this should be deferred."

You have been given the council's initial briefings below. Synthesize them into your opening message. Be concise — 3-5 sentences max for the synthesis, then one clear question or item to work through first.`
  }
};

// Simple in-memory rate limiter for AI endpoints
const aiRateLimit = new Map();
function checkAIRateLimit(userId) {
  const now = Date.now();
  const key = `ai:${userId}`;
  const entry = aiRateLimit.get(key) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  aiRateLimit.set(key, entry);
  return entry.count <= 10; // 10 AI calls per minute per user
}

app.post('/api/council/invoke', ensureAuth, async (req, res) => {
  if (!checkAIRateLimit(req.user.id)) {
    return res.status(429).json({ error: 'Too many AI requests. Wait a moment.' });
  }
  const { agent, message, history = [], focusTask, councilBriefings } = req.body;
  if (!agent || !COUNCIL_PERSONAS[agent]) return res.status(400).json({ error: 'unknown agent' });
  if (!message) return res.status(400).json({ error: 'message required' });

  const persona = COUNCIL_PERSONAS[agent];
  const ctx = buildTaskContext(req.user.id);

  const focusBlock = focusTask ? ('\n\nFOCUS TASK:\n' + JSON.stringify(focusTask, null, 2)) : '';
  const contextBlock = 'CURRENT DATE: ' + ctx.today
    + '\nTOTAL ACTIVE TASKS: ' + ctx.totalActive
    + '\n\nTASK STATE:\n' + JSON.stringify(ctx.tasks, null, 2)
    + '\n\nRECENT EVENTS (last 14 days):\n' + JSON.stringify(ctx.events, null, 2)
    + focusBlock;

  // For moderator: inject council briefings as additional context
  const briefingBlock = (agent === 'moderator' && councilBriefings)
    ? '\n\nCOUNCIL BRIEFINGS:\n' + Object.entries(councilBriefings)
        .map(([a, b]) => '[' + a.toUpperCase() + ']\n' + b).join('\n\n')
    : '';

  const systemPrompt = persona.system + '\n\nCONTEXT:\n' + contextBlock + briefingBlock;

  try {
    const response = await geminiInvoke(message, systemPrompt, history);
    res.json({ response, agent, agentName: persona.name });
  } catch (e) {
    console.error('Council invoke error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/council/extract', ensureAuth, async (req, res) => {
  const { sessionId, transcript } = req.body;
  if (!sessionId || !transcript) return res.status(400).json({ error: 'sessionId and transcript required' });

  const extractPrompt = `You are a session analyst. Below is a planning council session transcript between a user and four AI agents (Strategist, Risk Scout, Psychologist, Domain Expert).

Extract the key decisions, commitments, risks flagged, and next actions discussed. Return ONLY valid JSON in this exact format:
{
  "decisions": [{"type": "prioritise|defer|drop|split|update_deadline|create_task", "task": "task name or null", "rationale": "brief reason", "proposedBy": "agent name"}],
  "risks": [{"task": "task name", "risk": "description", "severity": "low|medium|high"}],
  "psychLoad": {"level": "low|medium|high", "notes": "brief observation"},
  "nextActions": ["action 1", "action 2"],
  "summary": "2-3 sentence plain language summary of what was decided"
}

TRANSCRIPT:
${transcript.slice(0, 8000)}`;

  try {
    const raw = await geminiInvoke(extractPrompt);
    const clean = raw.replace(/```json|```/g, '').trim();
    let extracted;
    try { extracted = JSON.parse(clean); }
    catch { extracted = { summary: raw, decisions: [], risks: [], nextActions: [] }; }

    // Save decisions to DB
    if (sessionId) {
      for (const d of (extracted.decisions || [])) {
        db.prepare(`INSERT INTO session_decisions (session_id,ts,decision_type,task_id,proposed_by,rationale)
          VALUES (?,datetime('now'),?,NULL,?,?)`
        ).run(sessionId, d.type || 'note', d.proposedBy || 'council', d.rationale || '');
      }
      // Save full extraction as a session event
      db.prepare(`INSERT INTO session_events (session_id,ts,agent,event_type,content)
        VALUES (?,datetime('now'),'system','extraction',?)`
      ).run(sessionId, JSON.stringify(extracted));
      // Close the session
      db.prepare("UPDATE plan_sessions SET ended_at=datetime('now') WHERE id=?").run(sessionId);
    }
    res.json({ ok: true, extracted });
  } catch (e) {
    console.error('Extract error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/plan-sessions', ensureAuth, (req, res) => {
  const { id, triggered, domain, task_ids, task_snapshot } = req.body;
  const sessionId = id || `ps_${Date.now()}_${domain||'all'}`;
  db.prepare(`INSERT OR REPLACE INTO plan_sessions (id,triggered,domain,task_ids,started_at,task_snapshot)
    VALUES (?,?,?,?,datetime('now'),?)`).run(sessionId, triggered||'manual', domain||'all',
    JSON.stringify(task_ids||[]), JSON.stringify(task_snapshot||{}));
  res.json({ ok:true, id:sessionId });
});

app.patch('/api/plan-sessions/:id/close', ensureAuth, (req, res) => {
  db.prepare("UPDATE plan_sessions SET ended_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ ok:true });
});

app.post('/api/plan-sessions/:id/events', ensureAuth, (req, res) => {
  const { agent, event_type, task_id, content } = req.body;
  const r = db.prepare(`INSERT INTO session_events (session_id,ts,agent,event_type,task_id,content)
    VALUES (?,datetime('now'),?,?,?,?)`).run(req.params.id, agent, event_type, task_id||null, JSON.stringify(content||{}));
  res.json({ ok:true, id:r.lastInsertRowid });
});

app.post('/api/plan-sessions/:id/decisions', ensureAuth, (req, res) => {
  const { decision_type, task_id, proposed_by, accepted, rationale } = req.body;
  const r = db.prepare(`INSERT INTO session_decisions (session_id,ts,decision_type,task_id,proposed_by,accepted,rationale)
    VALUES (?,datetime('now'),?,?,?,?,?)`).run(req.params.id, decision_type, task_id||null, proposed_by, accepted, rationale||'');
  res.json({ ok:true, id:r.lastInsertRowid });
});

app.get('/api/plan-sessions', ensureAuth, (req, res) => {
  const sessions = db.prepare('SELECT * FROM plan_sessions ORDER BY started_at DESC LIMIT 20').all();
  res.json({ sessions });
});

app.get('/api/plan-sessions/:id/events', ensureAuth, (req, res) => {
  const events = db.prepare('SELECT * FROM session_events WHERE session_id=? ORDER BY ts ASC').all(req.params.id);
  res.json({ events });
});

app.get('/api/meta-insights', ensureAuth, (req, res) => {
  const unseen = db.prepare('SELECT * FROM meta_insights WHERE surfaced=0 ORDER BY generated_at DESC').all();
  res.json({ insights: unseen });
});

app.patch('/api/meta-insights/:id/seen', ensureAuth, (req, res) => {
  db.prepare('UPDATE meta_insights SET surfaced=1 WHERE id=?').run(+req.params.id);
  res.json({ ok:true });
});

app.listen(PORT, '127.0.0.1', () => console.log(`Organizer running on 127.0.0.1:${PORT}`));
