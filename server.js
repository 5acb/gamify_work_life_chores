const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'tasks.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data dir exists
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// Load tasks
function loadTasks() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Save tasks
function saveTasks(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET tasks
app.get('/api/tasks', (req, res) => {
  const data = loadTasks();
  if (!data) return res.json({ tasks: null });
  res.json(data);
});

// PUT tasks (full state save)
app.put('/api/tasks', (req, res) => {
  saveTasks(req.body);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Organizer running on :${PORT}`);
});
