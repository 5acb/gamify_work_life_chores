-- Organizer schema (no seed data — see infra repo for bootstrapping)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  plan_date TEXT,
  due_date TEXT,
  plan_label TEXT,
  due_label TEXT,
  speed INTEGER DEFAULT 0,
  stakes INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  archived_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blockers (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocked_by)
);

CREATE TABLE IF NOT EXISTS ui_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
