const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/opt/organizer/data/organizer.db';

const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- Auth middleware ----
// ARCH-3: single middleware that resolves req.user from X-Auth-User header.
// Apply to all routes that need an authenticated user.
function ensureAuth(req, res, next) {
  const username = req.headers['x-auth-user'];
  if (!username) return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE slug = ?').get(username);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// ---- Helpers ----
function getUser(slug) {
  return db.prepare('SELECT * FROM users WHERE slug = ?').get(slug);
}

function getTasksForUser(userId, archived) {
  const where = archived ? 'WHERE t.user_id = ? AND t.archived = 1' : 'WHERE t.user_id = ? AND t.archived = 0';
  const tasks = db.prepare(`SELECT t.* FROM tasks t ${where} ORDER BY t.sort_order`).all(userId);
  const ids = tasks.map(t => t.id);
  if (!ids.length) return tasks;
  const ph = ids.map(() => '?').join(',');
  const subtasks = db.prepare(`SELECT * FROM subtasks WHERE task_id IN (${ph}) ORDER BY task_id, sort_order`).all(...ids);
  const blockers = db.prepare(`SELECT * FROM blockers WHERE task_id IN (${ph})`).all(...ids);
  const taskMap = {};
  for (const t of tasks) { t.subs = []; t.needs = []; taskMap[t.id] = t; }
  for (const s of subtasks) { if (taskMap[s.task_id]) taskMap[s.task_id].subs.push(s); }
  for (const b of blockers) { if (taskMap[b.task_id]) taskMap[b.task_id].needs.push(b.blocked_by); }
  return tasks;
}

// SEC-1: helper to verify a task belongs to the authenticated user
function requireTaskOwner(req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) { res.status(404).json({ error: 'not found' }); return null; }
  if (task.user_id !== req.user.id) { res.status(403).json({ error: 'forbidden' }); return null; }
  return task;
}

// SEC-1: helper to verify a subtask's parent task belongs to the authenticated user
function requireSubtaskOwner(req, res) {
  const sub = db.prepare(`
    SELECT s.*, t.user_id FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?
  `).get(req.params.id);
  if (!sub) { res.status(404).json({ error: 'not found' }); return null; }
  if (sub.user_id !== req.user.id) { res.status(403).json({ error: 'forbidden' }); return null; }
  return sub;
}

// ---- Root: auto-redirect based on auth ----
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
app.get('/api/users', (req, res) => {
  res.json({ users: db.prepare('SELECT id, name, slug FROM users ORDER BY id').all() });
});

// ---- API: Tasks (user-scoped) ----
// SEC-1: slug routes verify caller owns the slug
app.get('/api/users/:slug/tasks', ensureAuth, (req, res) => {
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const archived = req.query.view === 'archived';
  res.json({ tasks: getTasksForUser(req.user.id, archived), user: req.user });
});

app.post('/api/users/:slug/tasks', ensureAuth, (req, res) => {
  // SEC-1: only create tasks on your own board
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const { domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, needs, subs } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as max_sort_order FROM tasks WHERE user_id = ?').get(req.user.id);
  // CLEAN-1: wrap multi-INSERT in a transaction to prevent orphans
  const createTask = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO tasks (user_id, domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(req.user.id, domain, name, plan_date || null, due_date || null, plan_label || '', due_label || '', speed || 0, stakes || 0, maxOrder.max_sort_order + 1);
    const taskId = result.lastInsertRowid;
    if (needs && needs.length) {
      const ins = db.prepare('INSERT INTO blockers (task_id, blocked_by) VALUES (?, ?)');
      for (const n of needs) ins.run(taskId, n);
    }
    if (subs && subs.length) {
      const ins = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)');
      subs.forEach((s, i) => ins.run(taskId, s, i + 1));
    }
    return taskId;
  });
  const taskId = createTask();
  res.json({ ok: true, id: taskId });
});

// ---- API: Tasks (by id) ----
app.patch('/api/tasks/:id', ensureAuth, (req, res) => {
  // SEC-1: verify ownership before mutating
  if (!requireTaskOwner(req, res)) return;
  const fields = ['domain','name','plan_date','due_date','plan_label','due_label','speed','stakes','sort_order','done'];
  const sets = []; const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = datetime("now")');
  vals.push(req.params.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/toggle', ensureAuth, (req, res) => {
  const task = requireTaskOwner(req, res);
  if (!task) return;
  db.prepare('UPDATE tasks SET done = ?, updated_at = datetime("now") WHERE id = ?').run(task.done ? 0 : 1, task.id);
  res.json({ ok: true, done: !task.done });
});

app.patch('/api/tasks/:id/archive', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  db.prepare('UPDATE tasks SET archived = 1, archived_at = datetime("now"), updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/unarchive', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  db.prepare('UPDATE tasks SET archived = 0, archived_at = NULL, updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', ensureAuth, (req, res) => {
  if (!requireTaskOwner(req, res)) return;
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- API: Subtasks ----
app.post('/api/tasks/:id/subtasks', ensureAuth, (req, res) => {
  // SEC-1: task must belong to caller
  const task = requireTaskOwner(req, res);
  if (!task) return;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as max_sort_order FROM subtasks WHERE task_id = ?').get(req.params.id);
  const result = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)').run(req.params.id, label, maxOrder.max_sort_order + 1);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.patch('/api/subtasks/:id/toggle', ensureAuth, (req, res) => {
  const sub = requireSubtaskOwner(req, res);
  if (!sub) return;
  db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(sub.done ? 0 : 1, sub.id);
  db.prepare('UPDATE tasks SET updated_at = datetime("now") WHERE id = ?').run(sub.task_id);
  res.json({ ok: true, done: !sub.done });
});

app.patch('/api/subtasks/:id', ensureAuth, (req, res) => {
  if (!requireSubtaskOwner(req, res)) return;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
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
  // SEC-1: verify the task being modified belongs to caller
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.prepare('INSERT OR IGNORE INTO blockers (task_id, blocked_by) VALUES (?, ?)').run(task_id, blocked_by);
  res.json({ ok: true });
});

app.delete('/api/blockers', ensureAuth, (req, res) => {
  const { task_id, blocked_by } = req.body;
  // SEC-1: verify the task being modified belongs to caller
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM blockers WHERE task_id = ? AND blocked_by = ?').run(task_id, blocked_by);
  res.json({ ok: true });
});

// ---- API: UI State (per user) ----
app.put('/api/users/:slug/ui-state', ensureAuth, (req, res) => {
  // SEC-1: only write to your own ui-state
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const ins = db.prepare('INSERT OR REPLACE INTO ui_state (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) ins.run(req.user.slug + ':' + k, JSON.stringify(v));
  res.json({ ok: true });
});

app.get('/api/users/:slug/ui-state', ensureAuth, (req, res) => {
  // SEC-1: only read your own ui-state
  if (req.params.slug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT * FROM ui_state WHERE key LIKE ?').all(req.user.slug + ':%');
  const state = {};
  for (const r of rows) state[r.key.replace(req.user.slug + ':', '')] = JSON.parse(r.value);
  res.json(state);
});

// ---- Viz lab ----
app.get("/viz", (req, res) => res.sendFile(path.join(__dirname, "public", "viz.html")));

// ---- Agent: Gemini task analysis ----
app.post('/api/agent/gemini', ensureAuth, (req, res) => {
  const { question, slug: qSlug } = req.body;
  if (!question || !question.trim()) return res.status(400).json({ error: 'question required' });

  // SEC-1: only allow querying your own board
  if (qSlug && qSlug !== req.user.slug) return res.status(403).json({ error: 'forbidden' });
  const user = req.user;

  const today = new Date().toISOString().split('T')[0];
  const tasks = db.prepare(`
    SELECT t.id, t.domain, t.name, t.speed, t.stakes, t.done, t.plan_date, t.due_date
    FROM tasks t WHERE t.user_id = ? AND t.archived = 0 ORDER BY t.sort_order
  `).all(user.id);
  const blockers = db.prepare(`
    SELECT b.task_id, t1.name task_name, b.blocked_by, t2.name blocked_by_name
    FROM blockers b
    JOIN tasks t1 ON t1.id = b.task_id
    JOIN tasks t2 ON t2.id = b.blocked_by
    WHERE t1.user_id = ?
  `).all(user.id);
  const subtasks = db.prepare(`
    SELECT s.task_id, s.label, s.done
    FROM subtasks s JOIN tasks t ON t.id = s.task_id
    WHERE t.user_id = ? AND t.archived = 0
    ORDER BY s.task_id, s.sort_order
  `).all(user.id);

  const speed = ['snap', 'sesh', 'grind'];
  const stakes = ['low', 'high', 'crit'];
  const taskLines = tasks.map(t =>
    `[${t.id}] ${t.domain} | ${t.name} | ${speed[t.speed]} | ${stakes[t.stakes]} | ${t.done ? 'done' : 'pending'} | ${t.plan_date || '?'} → ${t.due_date || '?'}`
  ).join('\n');
  const blockerLines = blockers.map(b => `"${b.task_name}" needs "${b.blocked_by_name}"`).join('\n') || 'none';
  const subLines = subtasks.length
    ? subtasks.map(s => `  [task ${s.task_id}] ${s.done ? '✓' : '○'} ${s.label}`).join('\n')
    : 'none';

  const prompt = [
    `You are a productivity assistant for ${user.name}. Today is ${today}.`,
    `Speed: snap=quick, sesh=medium, grind=long. Stakes: low/high/crit.`,
    `\nCurrent tasks:\n${taskLines}`,
    `\nDependencies:\n${blockerLines}`,
    `\nSubtasks:\n${subLines}`,
    `\nAnswer concisely and practically: ${question.trim()}`,
  ].join('\n');

  const { spawnSync } = require('child_process');
  try {
    const r = spawnSync(
      'sudo', ['/opt/organizer/scripts/gemini-ask.sh'],
      { input: prompt, encoding: 'utf-8', timeout: 90000, env: process.env }
    );
    if (r.error) throw r.error;
    const raw = r.stdout || '';
    const start = raw.indexOf('{');
    const parsed = start >= 0 ? JSON.parse(raw.slice(start)) : {};
    const model = Object.keys(parsed.stats?.models || {})[0] || null;
    res.json({ answer: parsed.response || raw, model });
  } catch (e) {
    res.status(500).json({ error: e.message.slice(0, 200) });
  }
});

// ---- SPA: serve index.html for board routes ----
app.get('/:slug', (req, res) => {
  if (req.params.slug.startsWith('api')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Organizer running on :${PORT}`));
