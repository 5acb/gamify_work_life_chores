# gamify_work_life_chores

A personal productivity system with task dependency tracking, subtask breakdown, progress visualization, and multi-user boards. Designed to reduce task anxiety through gamification principles — unlock mechanics, progress bars, urgency-based color coding, and incremental subtask completion.

Live at [7ay.de](https://7ay.de) (behind basic auth).

## Why This Exists

Built during a grad school semester crunch to solve a specific problem: seeing 21+ tasks across 5 domains as overwhelming blobs instead of manageable sequences. The design draws on:

- **Game skill trees** — tasks unlock when blockers are completed, giving visual progression
- **Zeigarnik effect** — partially completed tasks (visible progress bars) create motivation to finish
- **Implementation intentions** — each task has a planned start date separate from the deadline, making "when will I do this" explicit
- **Chunking** — subtasks break amorphous work into checkable actions so you never think about the whole task, just the next step

## Architecture

```
Browser ──HTTPS──▶ Nginx (443)
                     │
                     ├── basic auth (per-user credentials)
                     ├── X-Auth-User header injected
                     │
                     └──▶ Node/Express (3000)
                            │
                            ├── GET /          → 302 redirect to /:username
                            ├── GET /api/me    → returns auth'd user
                            ├── GET /:slug     → serves SPA
                            └── /api/*         → REST endpoints
                                  │
                                  ▼
                            SQLite (WAL mode)
                         /opt/organizer/data/organizer.db
```

Single-file SPA frontend (`public/index.html`) with a REST API backend. No build step, no bundler, no framework — vanilla JS + Express + better-sqlite3.

## Features

### Task Management
- **Multi-user boards** — each person gets their own board at `/:slug`, auto-routed by basic auth username
- **Task cards** with domain color coding, speed/stakes indicators, plan/due dates, T-minus countdown pills
- **Buffer visualization** — dots between T-plan and T-due show days of slack; red→orange→tan→grey urgency scale
- **Subtasks** with checkboxes, inline add/delete, progress bars
- **Dependency tracking** — tasks can be blocked by other tasks; subtasks remain interactive even when parent is blocked
- **Archive system** — current/archived segment toggle; completed tasks can be archived and recovered

### UX
- **Auto-expand** — T-0/T-1/T-2 tasks expand automatically so next actions are always visible
- **Blocker messaging** — "Completion blocked by: X" or "All prep done — waiting on: X" depending on subtask state
- **Search** — real-time filter across task names, domains, and subtask labels
- **Edit modal** — bottom sheet for modifying all task fields (mobile thumb-friendly)
- **Dark mode** — designed for dark mode first; warm urgency colors (red/orange/tan) vs cool domain colors (blue/purple/teal)

### Infrastructure
- **SQLite persistence** with WAL mode for concurrent reads
- **Auto-backup** every 7 minutes — `sqlite3 .dump` to text SQL, auto-committed to git
- **MCP integration** — Claude can read/write the database directly from chat via server-side tooling
- **Per-user UI state** — expanded card state persists per user

## Data Model

See [`schema.sql`](schema.sql) for the full schema.

| Table | Purpose |
|-------|---------|
| `users` | Board owners (`name`, `slug`) |
| `tasks` | Main items: domain, dates, speed, stakes, sort_order, done, archived, user_id |
| `subtasks` | Checklist items under each task |
| `blockers` | Dependency edges (task A blocked by task B), many-to-many |
| `ui_state` | Per-user UI preferences (expanded cards etc.) |

### Dimensions

**Domain** — the life area: `CTI`, `ECM`, `CSD`, `GRA`, `Personal`. Cool-toned colors (blue, purple, teal, sky, periwinkle) via 5px left border + outlined chip. Deliberately separated from urgency colors.

**Speed** (0-2) — how long once you start: `snap` (under 30 min), `sesh` (few hours), `grind` (multi-day). Grey pill, neutral.

**Stakes** (0-2) — consequence of missing: `low` (grade padding), `high` (real impact), `crit` (degree/legal/cascading). Warm escalating pill: grey → orange → red.

**Buffer** — dots between T-plan and T-due pills. 0 dots = no slack. Max 7 dots displayed. Color matches urgency scale.

## API

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Returns the authenticated user (from `X-Auth-User` header) |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/:slug/tasks` | Get tasks (`?view=archived` for archived) |
| POST | `/api/users/:slug/tasks` | Create task (body: domain, name, dates, speed, stakes, needs[], subs[]) |
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
| POST | `/api/tasks/:id/subtasks` | Add subtask (body: `{label}`) |
| PATCH | `/api/subtasks/:id` | Update subtask label |
| PATCH | `/api/subtasks/:id/toggle` | Toggle subtask done |
| DELETE | `/api/subtasks/:id` | Delete subtask |

### Blockers
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/blockers` | Add dependency (body: `{task_id, blocked_by}`) |
| DELETE | `/api/blockers` | Remove dependency |

## Running Locally

```bash
npm install
mkdir -p data
sqlite3 data/organizer.db < schema.sql
sqlite3 data/organizer.db "INSERT INTO users (name, slug) VALUES ('You', 'you');"
PORT=3000 DB_PATH=./data/organizer.db node server.js
```

Visit `http://localhost:3000` (without nginx, no auto-redirect — go to `http://localhost:3000/you` directly).

## File Structure

```
├── server.js          # Express API + auth routing + SQLite queries
├── schema.sql         # Database schema (no seed data)
├── package.json       # express, better-sqlite3
├── public/
│   └── index.html     # Single-file SPA (vanilla JS, all CSS inline)
├── scripts/
│   └── backup.sh      # SQLite dump → SQL text, auto-commit
└── .gitignore         # Excludes node_modules, data/, *.db, backup.sql
```

## Design Decisions

**No framework.** The entire frontend is one HTML file with inline CSS and vanilla JS. This is intentional — no build step, no node_modules for the frontend, instant deploys, zero tooling friction. The app is small enough that a framework would add complexity without benefit.

**SQLite over Postgres.** Single-user app on a single server. SQLite with WAL mode handles concurrent reads cleanly. Backup is a single file dump. No connection management, no separate process.

**Warm vs cool color separation.** Urgency indicators use only warm tones (red → orange → tan → grey) because human peripheral vision detects warm colors faster. Domain indicators use only cool tones (blue, purple, teal). Two independent visual channels that don't interfere — you can scan by either dimension.

**Buffer dots, not numbers.** The visual weight of dots communicates slack faster than reading "3 days buffer." Zero dots between two red pills is immediately alarming. Seven grey dots is visually calm. No reading required.

**Subtasks always interactive on blocked tasks.** A task being "blocked" means it can't be marked complete, not that you can't prep. This matches reality — you can open OSCAR and research courses before talking to your advisor. The blocker is on the final step, not the prep work.

## License

Private project. Source published for reference.
