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
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helpers ----
function getAllTasks(includeArchived) {
  const where = includeArchived ? '' : 'WHERE t.archived = 0';
  const tasks = db.prepare(`SELECT t.* FROM tasks t ${where} ORDER BY t.sort_order`).all();
  const subtasks = db.prepare('SELECT * FROM subtasks ORDER BY task_id, sort_order').all();
  const blockers = db.prepare('SELECT * FROM blockers').all();
  const taskMap = {};
  for (const t of tasks) { t.subs = []; t.needs = []; taskMap[t.id] = t; }
  for (const s of subtasks) { if (taskMap[s.task_id]) taskMap[s.task_id].subs.push(s); }
  for (const b of blockers) { if (taskMap[b.task_id]) taskMap[b.task_id].needs.push(b.blocked_by); }
  return tasks;
}

// ---- API: Tasks ----
app.get('/api/tasks', (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json({ tasks: getAllTasks(includeArchived) });
});

app.post('/api/tasks', (req, res) => {
  const { domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, needs, subs } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM tasks').get();
  const result = db.prepare(
    'INSERT INTO tasks (domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, sort_order) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(domain, name, plan_date || null, due_date || null, plan_label || '', due_label || '', speed || 0, stakes || 0, maxOrder.m + 1);
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

// ---- API: Search ----
app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  const tasks = db.prepare(`
    SELECT t.* FROM tasks t
    WHERE (t.name LIKE ? OR t.domain LIKE ? OR t.id IN (
      SELECT s.task_id FROM subtasks s WHERE s.label LIKE ?
    ))
    ORDER BY t.sort_order
  `).all(`%${q}%`, `%${q}%`, `%${q}%`);
  const ids = tasks.map(t => t.id);
  const subtasks = ids.length ? db.prepare(`SELECT * FROM subtasks WHERE task_id IN (${ids.join(',')}) ORDER BY task_id, sort_order`).all() : [];
  const blockers = ids.length ? db.prepare(`SELECT * FROM blockers WHERE task_id IN (${ids.join(',')}) OR blocked_by IN (${ids.join(',')})`).all() : [];
  const taskMap = {};
  for (const t of tasks) { t.subs = []; t.needs = []; taskMap[t.id] = t; }
  for (const s of subtasks) { if (taskMap[s.task_id]) taskMap[s.task_id].subs.push(s); }
  for (const b of blockers) { if (taskMap[b.task_id]) taskMap[b.task_id].needs.push(b.blocked_by); }
  res.json({ tasks });
});

// ---- API: UI State ----
app.put('/api/ui-state', (req, res) => {
  const ins = db.prepare('INSERT OR REPLACE INTO ui_state (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) ins.run(k, JSON.stringify(v));
  res.json({ ok: true });
});

app.get('/api/ui-state', (req, res) => {
  const rows = db.prepare('SELECT * FROM ui_state').all();
  const state = {};
  for (const r of rows) state[r.key] = JSON.parse(r.value);
  res.json(state);
});

app.listen(PORT, () => console.log(`Organizer running on :${PORT}`));
