# 7ay.de Infrastructure & App TODO
# Generated: 2026-04-08 from arch_review + security_audit + cleanup agents
# Priority: P0 (do now) → P1 (this week) → P2 (soon) → P3 (backlog)

## P0 — Security Critical

- [ ] **SEC-1: Fix broken access control** — Add ownership checks to ALL task/user routes. Every PATCH/DELETE/PUT must verify `task.user_id = req.user.id`. Every `:slug` route must verify `slug = req.user.slug`.
  - Files: `server.js` (all /api/tasks and /api/users routes)

- [ ] **SEC-2: Remove backup.sql from public repo** — Contains full DB dump. Delete from repo, add to .gitignore, move backups to `/opt/organizer/data/backups/` (outside repo).
  - Files: `scripts/backup.sh`, `backup.sql`, `.gitignore`

- [ ] **SEC-3: Remove hardcoded MCP token** — `.gemini/settings.json` has the token committed. Move to env var or read from systemd env at runtime.
  - Files: `.gemini/settings.json`, `.gitignore`

- [ ] **SEC-4: Strip X-Auth-User from client requests in nginx** — Add `proxy_set_header X-Auth-User "";` before setting the real value to prevent header spoofing.
  - Files: `/etc/nginx/sites-available/organizer`

## P1 — Security High + Arch High

- [ ] **SEC-5: Add CSRF protection** — Implement custom header check (`X-Requested-With`) for all non-GET requests. Browser auto-sends Basic Auth so malicious sites can trigger mutations.
  - Files: `server.js` (middleware)

- [ ] **SEC-6: Remove sudo from Express** — Grant `deploy` user specific permissions instead of sudo-spawning `gemini-ask.sh` as root.
  - Files: `server.js`, `/etc/sudoers.d/gemini-ask`

- [ ] **SEC-7: Fix stored XSS** — Replace `innerHTML` with `textContent` for all user-provided data (task names, labels).
  - Files: `public/index.html`

- [ ] **ARCH-1: Split index.html** — Extract `style.css` and `app.js` from the ~850-line monolith. Biggest maintainability win.
  - Files: `public/index.html` → `public/index.html` + `public/style.css` + `public/app.js`

- [ ] **ARCH-2: Single-query task fetching with SQLite JSON** — Replace 3 separate queries + JS joins with `json_group_array`/`json_object`.
  - Files: `server.js` (getTasksForUser)

- [ ] **ARCH-3: ensureAuth middleware** — Single middleware resolving `req.user` from `X-Auth-User`. Remove duplicate `getAuthUser`/`getUser` calls. Standardize slug vs header auth.
  - Files: `server.js`

## P2 — Cleanup + Arch Medium

- [ ] **CLEAN-1: Wrap task creation in transaction** — Multi-INSERT (task + blockers + subtasks) needs `db.transaction` to prevent orphans.
  - Files: `server.js` (POST /api/users/:slug/tasks)

- [ ] **CLEAN-2: Consolidate task fetching** — API route and Gemini agent route have divergent task query logic. Single source of truth.
  - Files: `server.js`

- [ ] **CLEAN-3: Standardize API responses** — Some routes return `{ok:true}`, others return raw objects. Pick one pattern.
  - Files: `server.js`

- [ ] **CLEAN-4: Template literal components** — Replace string concatenation with small pure functions returning template literals (TaskCard, SubtaskItem, etc).
  - Files: `public/index.html` (or `public/app.js` after ARCH-1)

- [ ] **CLEAN-5: Deduplicate constants** — DM (domain map), TL/SL constants hardcoded in index.html, viz.html, timeline.html. Single source of truth.
  - Files: `public/*.html`

- [ ] **ARCH-4: Move Gemini agent calls to background** — Shell-spawning inside Express request handler is a stability risk. Background queue or native SDK.
  - Files: `server.js`

## P3 — Backlog / Dead Code

- [ ] **CLEAN-6: Delete public/timeline.html** — Superseded by integrated timeline in index.html.
- [ ] **CLEAN-7: Delete debug PNGs** — ~12 screenshot files (debug-board.png, viz-dag.png, etc) not referenced by app.
- [ ] **CLEAN-8: Verify gemini-ask.sh path** — server.js calls `/opt/organizer/scripts/gemini-ask.sh` but it's not in the repo's `scripts/` dir.
- [ ] **CLEAN-9: Rename cryptic variables** — `maxOrder.m` → `maxOrder.max_sort_order`, standardize `qSlug` vs `slug`.

## Infrastructure (completed this session)

- [x] Append-only JSONL changelog with hash-chain verification
- [x] 5 Gemini subagents (code_review, security_audit, arch_review, doc_sync, cleanup)
- [x] MCP tools: run_subagent, run_maintenance, view_changelog, verify_changelog
- [x] Changelog viewer at /changelog.html
- [x] Daily cron maintenance (6 AM UTC)
- [x] Both repos synced and pushed
