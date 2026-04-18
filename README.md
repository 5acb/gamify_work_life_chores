# gamify_work_life_chores

A personal productivity system with task dependency tracking, subtask breakdown, progress visualization, and multi-user boards. Evolved into an **Atmospheric Sanctuary**—a 2:1 split-pane interface that fuses skeuomorphic glass aesthetics with a functional oceanic palette to reduce task anxiety.

Live at [7ay.de](https://7ay.de) (cookie session auth — sign-in page at `/login`).

## The Journey
For a detailed narrative of the design evolution, state unification, and layout precision adjustments, see [**JOURNEY.md**](JOURNEY.md).

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
                     ├── TLS 1.3 only, HSTS 1yr
                     ├── rate-limits /login (burst=10)
                     ├── strips X-Auth-User header from clients
                     │
                     └──▶ Node/Express (3000)
                            │
                            ├── GET  /login    → sign-in form
                            ├── POST /login    → validates htpasswd, sets sid cookie
                            ├── GET  /logout   → clears sid cookie
                            ├── GET  /         → 302 → /:slug (ensureAuth)
                            ├── GET  /:slug    → serves SPA
                            └── /api/*         → REST endpoints (ensureAuth)
                                  │
                                  ▼
                            SQLite (WAL mode)
                         /opt/organizer/data/organizer.db
```

Split-file SPA frontend (index.html shell + style.css + app.js) with a REST API backend. No build step, no bundler, no framework — vanilla JS + Express + better-sqlite3. Uses `Sortable.js` for drag-to-reorder persistence. Gemini AI integration for task analysis.

## Features

### Atmospheric Sanctuary UI
- **2:1 Split Pane** — LHS (Worktree/Focus) and RHS (Task List).
- **Glass Aesthetics** — Backdrop blurs, semi-transparent tiles, and high-end material gradients.
- **Instrumental Header** — Consolidated "Command Cluster" with a full-width **Sanctuary Indicator Line** showing temporal distribution.
- **Donut Indicators** — Glowing hollow rings in action clusters providing "temporal frequency" (Canyon Red, Warm Amber, Marble Grey).

### Task Management
- **Persistent Reordering** — RHS cards can be dragged via a dedicated `⠿` handle; order persists via `ui-state` API.
- **Unified Terminal State** — "Done is Archived." Marking a task as done moves it to the background with a desaturated "hint" state.
- **Material Typography** — Task names use solid, luminous colors (Teal, Cobalt, Indigo, Murasaki) for perfect legibility.
- **Dynamic Urgency Hues** — Subtle background glows (Canyon, Amber, Marble) signal approaching deadlines without visual noise.
- **Smart Blocker Logic** — Cards automatically summarize prerequisites (e.g., "NEEDS: 3 PREREQS") and group them in a flexible footer to prevent text overlap.

### UX
- **Search** — Real-time filter across task names and domains.
- **Edit modal** — Glass-styled modal for modifying all task fields.
- **Dark mode** — Designed for dark mode first; atmospheric deep blues and obsidian tones.

## Data Model

See [`schema.sql`](schema.sql) for the full schema.

| Table | Purpose |
|-------|---------|
| `users` | Board owners (`name`, `slug`) |
| `tasks` | Main items: domain, dates, plan_label, due_label, speed, stakes, sort_order, done, archived, user_id |
| `subtasks` | Checklist items under each task |
| `blockers` | Dependency edges (task A blocked by task B), many-to-many |
| `ui_state` | Per-user UI preferences (order, expanded cards etc.) |
| `task_events` | Audit log: task lifecycle events (created, done, undone, archived, unarchived) |

## Running Locally

```bash
npm install
mkdir -p data
sqlite3 data/organizer.db < schema.sql
sqlite3 data/organizer.db "INSERT INTO users (name, slug) VALUES ('You', 'you');"
PORT=3000 DB_PATH=./data/organizer.db node server.js
```

Visit `http://localhost:3000` (without nginx, no auto-redirect — go to `http://localhost:3000/you` directly).

## Design Decisions

**No framework.** Vanilla JS + CSS variables allowed for absolute control over layout precision and "donut" alignments without fighting a virtual DOM or complex state managers.

**Warm vs cool color separation.** Domain indicators use cool material tones (Murasaki Purple, Asagi Teal). Urgency uses hot temporal tones (Canyon Red, Warm Amber). This creates two independent visual channels.

**Sanctuary Indicator Line.** Replaced loose points with a proportional line to create a sense of the sanctuary's "total temporal weight."

## License

Private project. Source published for reference.
