# gamify_work_life_chores

A personal task organizer with dependency tracking, subtasks, progress bars, and a multi-user board system. Built to manage academic deadlines, work tasks, and personal chores in one place.

Live at [7ay.de](https://7ay.de) (behind auth).

## Architecture

```
Browser ──HTTPS──▶ Nginx (443) ──proxy──▶ Node/Express (3000)
                                              │
                                              ▼
                                        SQLite (WAL mode)
                                     /opt/organizer/data/organizer.db
```

Single-file SPA frontend (`public/index.html`) with a REST API backend. No build step, no bundler, no framework — vanilla JS + Express + SQLite via `better-sqlite3`.

## Features

- **Multi-user boards** — each person gets their own task board at `/:slug`
- **Task cards** with domain tags, speed/stakes indicators, plan/due dates, countdown timers
- **Subtasks** with checkboxes, inline add/delete
- **Dependency tracking** — tasks can be blocked by other tasks; blocked tasks show lock badges
- **Progress bars** — based on subtask completion
- **Archive system** — completed tasks can be archived and viewed/unarchived later
- **Search** — filter tasks, subtasks, and domains in real-time
- **UI state persistence** — expanded card state saved per user
- **Auto-backup** — SQLite dump to SQL every 7 minutes via cron

## Data Model

See [`schema.sql`](schema.sql) for the full schema. Core tables:

| Table | Purpose |
|-------|---------|
| `users` | Board owners (name, slug) |
| `tasks` | Main task items with domain, dates, speed, stakes, sort order |
| `subtasks` | Checklist items under each task |
| `blockers` | Dependency edges between tasks (task A blocked by task B) |
| `ui_state` | Per-user UI preferences (expanded cards, etc.) |

### Domain Tags

Tasks are tagged with a domain: `CTI`, `ECM`, `CSD`, `GRA`, `Personal`. Each has a color in the UI. Domains are defined client-side in the `DM` object.

### Speed / Stakes

Two orthogonal dimensions per task:

- **Speed**: `snap` (quick), `sesh` (session-length), `grind` (multi-session)
- **Stakes**: `low`, `high`, `crit`

These are stored as integers 0-2 and rendered as colored pills.

## API

All endpoints return JSON. Tasks are scoped to users via slug.

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/:slug/tasks` | Get tasks for user (add `?view=archived` for archived) |
| POST | `/api/users/:slug/tasks` | Create task (body: domain, name, plan_date, due_date, plan_label, due_label, speed, stakes, needs[], subs[]) |
| GET | `/api/users/:slug/ui-state` | Get UI state |
| PUT | `/api/users/:slug/ui-state` | Save UI state |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/tasks/:id` | Update task fields |
| PATCH | `/api/tasks/:id/toggle` | Toggle done |
| PATCH | `/api/tasks/:id/archive` | Archive task |
| PATCH | `/api/tasks/:id/unarchive` | Unarchive task |
| DELETE | `/api/tasks/:id` | Delete task |

### Subtasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tasks/:id/subtasks` | Add subtask (body: label) |
| PATCH | `/api/subtasks/:id` | Update subtask label |
| PATCH | `/api/subtasks/:id/toggle` | Toggle subtask done |
| DELETE | `/api/subtasks/:id` | Delete subtask |

### Blockers
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/blockers` | Add blocker (body: task_id, blocked_by) |
| DELETE | `/api/blockers` | Remove blocker (body: task_id, blocked_by) |

## Running Locally

```bash
npm install
# Create the database
sqlite3 data/organizer.db < schema.sql
# Add a user
sqlite3 data/organizer.db "INSERT INTO users (name, slug) VALUES ('You', 'you');"
# Start
PORT=3000 DB_PATH=./data/organizer.db node server.js
```

Visit `http://localhost:3000/you`.

## Deployment

This app runs on a DigitalOcean droplet behind Nginx with HTTPS (Let's Encrypt). See the private infra repo for server configuration, MCP server, systemd services, and deployment automation.

The production database lives at `/opt/organizer/data/organizer.db` (outside the repo). Backups are committed as `backup.sql` to a separate location every 7 minutes via cron.

## File Structure

```
├── server.js          # Express API server
├── schema.sql         # Database schema (no seed data)
├── package.json       # Dependencies: express, better-sqlite3
├── public/
│   └── index.html     # Single-file SPA (vanilla JS, CSS-in-HTML)
├── scripts/
│   └── backup.sh      # SQLite dump + git commit
└── .gitignore
```

## License

Private project. Source published for reference.
