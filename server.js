const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/opt/organizer/data/organizer.db';

// SEC-16: allowed domain values
const VALID_DOMAINS = ['CTI', 'ECM', 'CSD', 'GRA', 'Personal'];

const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json());
// SEC-17: security headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- Middleware ----

// ARCH-3: single auth middleware
function ensureAuth(req, res, next) {
  const username = req.headers['x-auth-user'];
  if (!username) return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE slug = ?').get(username);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// SEC-5: CSRF protection — require X-Requested-With on all state-mutating requests.
// Browsers auto-send Basic Auth but won't set custom headers cross-origin.
function csrfCheck(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'csrf check failed' });
    }
  }
  next();
}
app.use(csrfCheck);

// ---- Helpers ----

// ARCH-2 + CLEAN-2: single query with SQLite JSON aggregation — used by both tasks route and Gemini agent
function getTasksForUser(userId, archived) {
  const archVal = archived ? 1 : 0;
  const rows = db.prepare(`
    SELECT
      t.*,
      COALESCE(json_group_array(
        CASE WHEN s.id IS NOT NULL
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

// ---- API: Who am I ----
app.get('/api/me', (req, res) => {
  const username = req.headers['x-auth-user'];
  if (!username) return res.json({ user: null });
  const user = db.prepare('SELECT id, name, slug, created_at FROM users WHERE slug = ?').get(username);
  res.json({ user: user || null });
});

// ---- API: Users ----
app.get('/api/users', ensureAuth, (req, res) => {
  res.json({ users: db.prepare('SELECT id, name, slug FROM users ORDER BY id').all() });
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
  const fields = ['domain','name','plan_date','due_date','plan_label','due_label','speed','stakes','sort_order','done'];
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
  db.prepare("UPDATE tasks SET done = ?, updated_at = datetime('now') WHERE id = ?").run(done, task.id);
  res.json({ ok: true, done: !!done });
});

app.patch('/api/tasks/:id/archive', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  db.prepare("UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/unarchive', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  db.prepare("UPDATE tasks SET archived = 0, archived_at = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
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

// ---- API: UI State (per user) ----
app.get('/api/users/:slug/ui-state', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT * FROM ui_state WHERE key GLOB ?').all(req.user.slug + ':*');
  const state = {};
  for (const r of rows) state[r.key.replace(req.user.slug + ':', '')] = JSON.parse(r.value);
  res.json(state);
});

app.put('/api/users/:slug/ui-state', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const ins = db.prepare('INSERT OR REPLACE INTO ui_state (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) ins.run(req.user.slug + ':' + k, JSON.stringify(v));
  res.json({ ok: true });
});

// ---- Agent: Gemini task analysis ----
// SEC-18: Rate limit: 5 requests per minute per user for Gemini endpoint
const geminiLimiter = {};
function checkGeminiRate(userId) {
  const now = Date.now(), window = 60000, max = 5;
  if (!geminiLimiter[userId]) geminiLimiter[userId] = [];
  geminiLimiter[userId] = geminiLimiter[userId].filter(t => now - t < window);
  if (geminiLimiter[userId].length >= max) return false;
  geminiLimiter[userId].push(now);
  return true;
}

app.post('/api/agent/gemini', ensureAuth, async (req, res) => {
  if (!checkGeminiRate(req.user.id)) return res.status(429).json({ error: 'rate limit exceeded, try again in a minute' });
  const { question, slug: qSlug } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });
  // SEC-13: limit question length
  if (question.length > 2000) return res.status(400).json({ error: 'question too long' });
  if (qSlug && qSlug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });

  const user = req.user;
  const today = new Date().toISOString().split('T')[0];
  // CLEAN-2: reuse getTasksForUser — single source of truth for task data
  const tasks = getTasksForUser(user.id, false);
  const blockers = db.prepare(`
    SELECT b.task_id, t1.name task_name, b.blocked_by, t2.name blocked_by_name
    FROM blockers b
    JOIN tasks t1 ON t1.id = b.task_id
    JOIN tasks t2 ON t2.id = b.blocked_by
    WHERE t1.user_id = ?
  `).all(user.id);

  const speed = ['snap', 'sesh', 'grind'];
  const stakes = ['low', 'high', 'crit'];
  const taskLines = tasks.map(t =>
    `[${t.id}] ${t.domain} | ${t.name} | ${speed[t.speed]} | ${stakes[t.stakes]} | ${t.done ? 'done' : 'pending'} | ${t.plan_date || '?'} → ${t.due_date || '?'}`
  ).join('\n');
  const blockerLines = blockers.map(b => `"${b.task_name}" needs "${b.blocked_by_name}"`).join('\n') || 'none';
  const subLines = tasks.flatMap(t => t.subs.map(s => `  [task ${t.id}] ${s.done ? '✓' : '○'} ${s.label}`)).join('\n') || 'none';

  const prompt = [
    `You are a productivity assistant for ${user.name}. Today is ${today}.`,
    `Speed: snap=quick, sesh=medium, grind=long. Stakes: low/high/crit.`,
    `\nCurrent tasks:\n${taskLines}`,
    `\nDependencies:\n${blockerLines}`,
    `\nSubtasks:\n${subLines}`,
    `\nAnswer concisely and practically: ${question.trim()}`,
  ].join('\n');

  // SEC-6: run gemini-ask.sh directly as deploy user — no sudo needed
  // ARCH-4: async spawn with exit code check + stderr capture
  try {
    const raw = await new Promise((resolve, reject) => {
      const child = spawn('/opt/organizer/scripts/gemini-ask.sh', []);
      let stdout = '', stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('gemini-ask.sh timed out after 90s'));
      }, 90000);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`gemini-ask.sh exited ${code}: ${(stderr || stdout).slice(0, 200)}`));
        else resolve(stdout);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
    const start = raw.indexOf('{');
    const parsed = start >= 0 ? JSON.parse(raw.slice(start)) : {};
    const model = Object.keys(parsed.stats?.models || {})[0] || null;
    res.json({ answer: parsed.response || raw, model });
  } catch (e) {
    // SEC-12: generic error message, don't leak internals
    console.error('Gemini agent error:', e.message);
    res.status(500).json({ error: 'gemini request failed' });
  }
});

// ---- SPA ----
app.get('/:slug', (req, res) => {
  if (req.params.slug.startsWith('api')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SEC-11: bind to localhost only — nginx handles external traffic
app.listen(PORT, '127.0.0.1', () => console.log(`Organizer running on 127.0.0.1:${PORT}`));
