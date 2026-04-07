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

// ---- API ----

// Get all tasks with subtasks and blockers
app.get('/api/tasks', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort_order').all();
  const subtasks = db.prepare('SELECT * FROM subtasks ORDER BY task_id, sort_order').all();
  const blockers = db.prepare('SELECT * FROM blockers').all();

  const taskMap = {};
  for (const t of tasks) {
    t.subs = [];
    t.needs = [];
    taskMap[t.id] = t;
  }
  for (const s of subtasks) {
    if (taskMap[s.task_id]) taskMap[s.task_id].subs.push(s);
  }
  for (const b of blockers) {
    if (taskMap[b.task_id]) taskMap[b.task_id].needs.push(b.blocked_by);
  }

  res.json({ tasks });
});

// Toggle subtask done
app.patch('/api/subtasks/:id/toggle', (req, res) => {
  const sub = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(sub.done ? 0 : 1, sub.id);
  db.prepare('UPDATE tasks SET updated_at = datetime("now") WHERE id = ?').run(sub.task_id);
  res.json({ ok: true, done: !sub.done });
});

// Toggle task done (for tasks without subtasks)
app.patch('/api/tasks/:id/toggle', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tasks SET done = ?, updated_at = datetime("now") WHERE id = ?').run(task.done ? 0 : 1, task.id);
  res.json({ ok: true, done: !task.done });
});

// Add a subtask
app.post('/api/tasks/:id/subtasks', (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM subtasks WHERE task_id = ?').get(req.params.id);
  const result = db.prepare('INSERT INTO subtasks (task_id, label, sort_order) VALUES (?, ?, ?)').run(req.params.id, label, maxOrder.m + 1);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Add a task
app.post('/api/tasks', (req, res) => {
  const { domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, needs } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM tasks').get();
  const result = db.prepare(
    'INSERT INTO tasks (domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, sort_order) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(domain, name, plan_date, due_date, plan_label, due_label, speed || 0, stakes || 0, maxOrder.m + 1);
  const taskId = result.lastInsertRowid;
  if (needs && needs.length) {
    const ins = db.prepare('INSERT INTO blockers (task_id, blocked_by) VALUES (?, ?)');
    for (const n of needs) ins.run(taskId, n);
  }
  res.json({ ok: true, id: taskId });
});

// Update task
app.patch('/api/tasks/:id', (req, res) => {
  const fields = ['domain','name','plan_date','due_date','plan_label','due_label','speed','stakes','sort_order','done'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = datetime("now")');
  vals.push(req.params.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

// Delete subtask
app.delete('/api/subtasks/:id', (req, res) => {
  db.prepare('DELETE FROM subtasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Save UI state (expanded panels etc)
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
