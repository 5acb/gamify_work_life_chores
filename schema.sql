-- Organizer schema
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
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

-- Seed tasks
INSERT INTO tasks (id, domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, sort_order) VALUES
(1,  'GRA',      'Order MDS hardware',              '2026-04-07','2026-04-07','Tonight','Tonight',              0,1,1),
(2,  'Personal', 'Discuss fall permits w/ Ronny',    '2026-04-08','2026-04-08','Wed Apr 8','Wed Apr 8',         0,2,2),
(3,  'Personal', 'Submit CoC permit survey',         '2026-04-08','2026-04-09','Wed Apr 8 eve','Thu Apr 9 9AM', 0,2,3),
(4,  'Personal', 'Sprintax tax filing',              '2026-04-07','2026-04-15','Tonight','Apr 15',              1,2,4),
(5,  'CSD',      'Quiz study — Kalman + drone ctrl', '2026-04-08','2026-04-08','Wed Apr 8','Wed Apr 8',        1,0,5),
(6,  'CSD',      'In-class quiz',                    '2026-04-09','2026-04-09','Thu Apr 9','Thu Apr 9',         0,0,6),
(7,  'CTI',      'Initial Intelligence Analysis',    '2026-04-08','2026-04-10','Wed Apr 8','Fri Apr 10',        2,1,7),
(8,  'ECM',      'Exam 3 — Security Assurance',      '2026-04-10','2026-04-12','Fri Apr 10','Sun Apr 12',      1,0,8),
(9,  'CSD',      'Kalman Filtering HW',              '2026-04-12','2026-04-13','Sun Apr 12','Mon Apr 13',      1,0,9),
(10, 'CTI',      'Red Cell Analysis',                '2026-04-13','2026-04-15','Mon Apr 13','Wed Apr 15',       1,1,10),
(11, 'CTI',      'Quiz #3',                          '2026-04-17','2026-04-18','Fri Apr 17','Sat Apr 18',       0,0,11),
(12, 'CTI',      'Final Analysis',                   '2026-04-19','2026-04-21','Sun Apr 19','Tue Apr 21',       2,1,12),
(13, 'CTI',      'Presentation + Notebook',          '2026-04-20','2026-04-22','Mon Apr 20','Wed Apr 22',       2,1,13),
(14, 'ECM',      'Panel 4 — Board Governance',       '2026-04-22','2026-04-22','Wed Apr 22','Wed Apr 22',       0,0,14),
(15, 'ECM',      'Extra Credit',                     '2026-04-23','2026-04-24','Thu Apr 23','Fri Apr 24',       0,0,15),
(16, 'CSD',      'Final Exam (cumulative)',           '2026-04-23','2026-04-23','Thu Apr 23','Thu Apr 23',       1,1,16),
(17, 'CTI',      'Intelligence Final Report',        '2026-04-27','2026-04-29','Mon Apr 27','Wed Apr 29',       2,1,17),
(18, 'GRA',      'GRA wrap-up',                      '2026-04-30','2026-05-03','Thu Apr 30','Sun May 3',        1,1,18),
(19, 'ECM',      'ECM Final Exam',                   '2026-04-30','2026-05-03','Thu Apr 30','Sun May 3',        1,0,19),
(20, 'Personal', 'Pack + move to storage',           '2026-05-02','2026-05-03','Sat May 2','Sun May 3',         1,0,20),
(21, 'Personal', 'Fly to SFO',                       '2026-05-04','2026-05-04','Mon May 4','Mon May 4',         0,0,21);

-- Seed subtasks
INSERT INTO subtasks (task_id, label, sort_order) VALUES
(1, 'Check with Claude — pull specs from prior research chat', 1),
(1, 'Find vendor — balance speed and cost', 2),
(1, 'Place order + track aggressively', 3),
(2, 'Message Ronny on Teams to confirm availability', 1),
(2, 'Prepare shortlist of fall courses to discuss', 2),
(2, 'Meet — confirm permit choices + any SPP requirements', 3),
(3, 'Open OSCAR — check schedule conflicts for Fall 2026', 1),
(3, 'Cross-ref equivalent courses chart (no repeats)', 2),
(3, 'Research candidate courses — check ratings, workload', 3),
(3, 'Finalise 4 CS/CSE course picks (needs Ronny input)', 4),
(3, 'Fill Qualtrics survey + submit before 9AM Thu', 5),
(4, 'Gather docs: W-2, 1042-S, visa info, SSN', 1),
(4, 'Log in to Sprintax — run through questionnaire', 2),
(4, 'Review generated 1040-NR', 3),
(4, 'E-file federal return', 4),
(4, 'Check if GA state return needed + file if so', 5),
(5, 'Download drone control slides from Canvas', 1),
(5, 'Review Kalman filtering lecture notes', 2),
(5, 'Work through any practice problems', 3),
(7, 'Assess current Resecurity research status — what is usable', 1),
(7, 'Draft initial analytic judgments', 2),
(7, 'Map findings to ICD 203 structure', 3),
(7, 'Write up findings document', 4),
(7, 'Review + submit', 5),
(8, 'Review Security Assurance lecture slides', 1),
(8, 'Open exam + complete', 2);

-- Seed blockers
INSERT INTO blockers (task_id, blocked_by) VALUES
(3, 2),
(6, 5),
(10, 7),
(12, 10),
(13, 12),
(17, 13),
(21, 18),
(21, 19),
(21, 20);
