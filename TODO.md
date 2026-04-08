# 7ay.de Infrastructure & App TODO
# Generated: 2026-04-08 from arch_review + security_audit + cleanup agents
# Updated: 2026-04-08 — bulk fixes applied across 2 sessions
# Priority: P0 (do now) → P1 (this week) → P2 (soon) → P3 (backlog)

## P0 — Security Critical (ALL DONE)

- [x] **SEC-1: Fix broken access control** — ensureAuth middleware + requireTaskOwner/requireSubtaskOwner helpers
- [x] **SEC-2: Remove backup.sql from public repo** — moved to /opt/organizer/data/backups/, added to .gitignore
- [x] **SEC-3: Remove hardcoded MCP token** — removed from .gemini/settings.json, added to .gitignore
- [x] **SEC-4: Strip X-Auth-User from client requests in nginx** — proxy_set_header added

## P1 — Security High + Arch High (ALL DONE)

- [x] **SEC-5: Add CSRF protection** — X-Requested-With header check middleware on all non-GET requests
- [x] **SEC-6: Remove sudo from Express** — gemini-ask.sh runs as deploy user directly
- [x] **SEC-7: Fix stored XSS** — esc() function + textContent for user data
- [x] **SEC-10: Require auth for viz page** — ensureAuth on /viz route (now deleted)
- [x] **SEC-11: Bind to localhost** — 127.0.0.1:3000, nginx handles external
- [x] **SEC-12: Generic error messages** — no internal leak in Gemini agent errors
- [x] **SEC-13: Limit question length** — 2000 char max on Gemini questions
- [x] **SEC-16: Domain allowlist** — VALID_DOMAINS validation on create/update
- [x] **ARCH-1: Split index.html** — extracted to index.html + style.css + app.js
- [x] **ARCH-2: Single-query task fetching** — SQLite JSON aggregation in getTasksForUser
- [x] **ARCH-3: ensureAuth middleware** — single middleware, req.user populated once
- [x] **ARCH-4: Async Gemini spawn** — 90s timeout, exit code check, stderr capture

## P2 — Cleanup + Arch Medium (ALL DONE)

- [x] **CLEAN-1: Wrap task creation in transaction** — db.transaction() wraps task+blockers+subtasks
- [x] **CLEAN-2: Consolidate task fetching** — single getTasksForUser used by API and Gemini agent
- [x] **CLEAN-3: Standardize API responses** — reviewed; intentional per-route shapes (toggle returns done, create returns id)
- [x] **CLEAN-4: Delete viz.html dead code** — removed viz.html (484 lines) and /viz route
- [x] **CLEAN-5: Constants deduplicated** — viz.html removed, constants only in app.js now
- [x] **CLEAN-9: Cryptic variables fixed** — maxOrder.max_sort_order already correct

## P2.5 — New fixes (2026-04-08 session 2)

- [x] **A11Y-1: Remove user-scalable=no** — viewport allows pinch zoom (WCAG 1.4.4)
- [x] **A11Y-2: Add ARIA landmarks** — role="main" on #root, noscript fallback
- [x] **A11Y-3: Color contrast** — --tx3 bumped from #5a5a65 to #71717a (WCAG AA)
- [x] **UX-1: Escape key closes modals** — keydown listener added
- [x] **UX-2: API error handling** — api() now throws on non-2xx, logs errors
- [x] **SEC-17: UI state LIKE injection** — changed to GLOB for safe prefix matching
- [x] **SEC-18: Input length validation** — task name 500, labels 100, subtask label 500

## P3 — Backlog / Remaining

- [x] **CLEAN-6: Delete public/timeline.html** — superseded (deleted in earlier session)
- [x] **CLEAN-7: Delete debug PNGs** — removed in earlier session
- [x] **CLEAN-8: Verify gemini-ask.sh** — confirmed at /opt/organizer/scripts/gemini-ask.sh, works

## Open items (new findings from UI/UX audit)

- [ ] **V1: FAB overlaps timeline cards** — + button covers bottom-left cards in timeline view
- [ ] **V2: Cards clipped at right edge** — rightmost cards overflow with no visual cue
- [ ] **V3: BLOCKED label low contrast** — gray on dark, hard to read
- [ ] **V4: Leader-line arrows overlap cards** — dependency arrows cross card text
- [ ] **S1: Rate limit /api/agent/gemini** — no throttle on Gemini endpoint
- [ ] **S2: Content-Security-Policy header** — not set (nginx or Express)
- [ ] **S3: /api/users unauthenticated** — returns all users without auth (user enumeration)
- [ ] **U1: No keyboard navigation for cards** — no tabindex, no arrow key support
- [ ] **U2: No focus trap in modals** — tab can escape to background elements
- [ ] **CLEAN-10: CDN fallback** — dayjs + leader-line from CDN with no local fallback

## Infrastructure (completed)

- [x] Append-only JSONL changelog with hash-chain verification
- [x] 5 Gemini subagents (code_review, security_audit, arch_review, doc_sync, cleanup)
- [x] MCP tools: run_subagent, run_maintenance, view_changelog, verify_changelog
- [x] Changelog viewer at /changelog.html
- [x] Daily cron maintenance (6 AM UTC)
- [x] Both repos synced and pushed
