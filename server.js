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

// ---- Helpers ----
function getAuthUser(req) {
  const username = req.headers['x-auth-user'];
  if (!username) return null;
  return db.prepare('SELECT * FROM users WHERE slug = ?').get(username);
}

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

// ---- Root: auto-redirect based on auth ----
app.get('/', (req, res) => {
  const user = getAuthUser(req);
  if (user) return res.redirect('/' + user.slug);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- API: Who am I ----
app.get('/api/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.json({ user: null });
  res.json({ user });
});

// ---- API: Users ----
app.get('/api/users', (req, res) => {
  res.json({ users: db.prepare('SELECT id, name, slug FROM users ORDER BY id').all() });
});

// ---- API: Tasks (user-scoped) ----
app.get('/api/users/:slug/tasks', (req, res) => {
  const user = getUser(req.params.slug);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const archived = req.query.view === 'archived';
  res.json({ tasks: getTasksForUser(user.id, archived), user });
});

app.post('/api/users/:slug/tasks', (req, res) => {
  const user = getUser(req.params.slug);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const { domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, needs, subs } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM tasks WHERE user_id = ?').get(user.id);
  const result = db.prepare(
    'INSERT INTO tasks (user_id, domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(user.id, domain, name, plan_date || null, due_date || null, plan_label || '', due_label || '', speed || 0, stakes || 0, maxOrder.m + 1);
  const taskId = result.lastInsertRowid;
  if (needs && needs.length) {
    const ins = db.prepare('INSERT INTO blockers (task_id, blocked_by) VALUES (?, ?)');
    for (const n of needs) ins.run(taskId, n);
  }
  if (subs && subs.length) {
    const ins = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)');
    subs.forEach((s, i) => ins.run(taskId, s, i + 1));
  }
  res.json({ ok: true, id: taskId });
});

// ---- API: Tasks (by id) ----
app.patch('/api/tasks/:id', (req, res) => {
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

app.patch('/api/tasks/:id/toggle', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tasks SET done = ?, updated_at = datetime("now") WHERE id = ?').run(task.done ? 0 : 1, task.id);
  res.json({ ok: true, done: !task.done });
});

app.patch('/api/tasks/:id/archive', (req, res) => {
  db.prepare('UPDATE tasks SET archived = 1, archived_at = datetime("now"), updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/tasks/:id/unarchive', (req, res) => {
  db.prepare('UPDATE tasks SET archived = 0, archived_at = NULL, updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- API: Subtasks ----
app.patch('/api/subtasks/:id/toggle', (req, res) => {
  const sub = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(sub.done ? 0 : 1, sub.id);
  db.prepare('UPDATE tasks SET updated_at = datetime("now") WHERE id = ?').run(sub.task_id);
  res.json({ ok: true, done: !sub.done });
});

app.post('/api/tasks/:id/subtasks', (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM subtasks WHERE task_id = ?').get(req.params.id);
  const result = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)').run(req.params.id, label, maxOrder.m + 1);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.patch('/api/subtasks/:id', (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  db.prepare('UPDATE subtasks SET label = ? WHERE id = ?').run(label, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/subtasks/:id', (req, res) => {
  db.prepare('DELETE FROM subtasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- API: Blockers ----
app.post('/api/blockers', (req, res) => {
  const { task_id, blocked_by } = req.body;
  db.prepare('INSERT OR IGNORE INTO blockers (task_id, blocked_by) VALUES (?, ?)').run(task_id, blocked_by);
  res.json({ ok: true });
});

app.delete('/api/blockers', (req, res) => {
  const { task_id, blocked_by } = req.body;
  db.prepare('DELETE FROM blockers WHERE task_id = ? AND blocked_by = ?').run(task_id, blocked_by);
  res.json({ ok: true });
});

// ---- API: UI State (per user) ----
app.put('/api/users/:slug/ui-state', (req, res) => {
  const user = getUser(req.params.slug);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const ins = db.prepare('INSERT OR REPLACE INTO ui_state (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) ins.run(user.slug + ':' + k, JSON.stringify(v));
  res.json({ ok: true });
});

app.get('/api/users/:slug/ui-state', (req, res) => {
  const user = getUser(req.params.slug);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const rows = db.prepare('SELECT * FROM ui_state WHERE key LIKE ?').all(user.slug + ':%');
  const state = {};
  for (const r of rows) state[r.key.replace(user.slug + ':', '')] = JSON.parse(r.value);
  res.json(state);
});

// ---- Viz lab ----
app.get("/viz", (req, res) => res.sendFile(path.join(__dirname, "public", "viz.html")));


// ---- Agent: Gemini task analysis ----
app.post('/api/agent/gemini', (req, res) => {
  const { question, slug: qSlug } = req.body;
  if (!question || !question.trim()) return res.status(400).json({ error: 'question required' });

  // Resolve user: body slug > auth header > first user
  const slug = qSlug || req.headers['x-auth-user'] || 'anas';
  const user = db.prepare('SELECT * FROM users WHERE slug = ?').get(slug);
  if (!user) return res.status(404).json({ error: 'user not found' });

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
    // Use sudo wrapper so gemini runs as root (has cached OAuth creds in /root/.gemini)
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
