# 7ay.de Infrastructure & App TODO
# Generated: 2026-04-08 from arch_review + security_audit + cleanup agents
# Updated: 2026-04-09 — audit sync (doc/system alignment)
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

- [x] **CLEAN-6: Delete public/timeline.html** — deleted 2026-04-09 (was marked done but still on disk)
- [x] **CLEAN-7: Delete debug PNGs** — removed in earlier session
- [x] **CLEAN-8: Verify gemini-ask.sh** — confirmed at /opt/organizer/scripts/gemini-ask.sh, works

## Open items (new findings from UI/UX audit)

- [x] **V1: FAB overlaps timeline cards** — tree-container padding-bottom increased to 140px
- [x] **V2: Cards clipped at right edge** — grid split adjusted + tree padding reduced
- [x] **V3: BLOCKED label low contrast** — changed to Canyon Red border/text
- [x] **V4: Leader-line arrows overlap cards** — N/A (leader-line lib not found in codebase)
- [x] **S1: Rate limit /api/agent/gemini** — 10 req/min limit applied
- [x] **S3: /api/users unauthenticated** — restricted to self-only response
- [x] **U1: No keyboard navigation for cards** — tabindex=0 + Enter listener added
- [x] **U2: No focus trap in modals** — Tab loop + Escape handler implemented
- [x] **CLEAN-10: CDN fallback** — local fallback for Sortable and WebAuthn added (dayjs/leader-line N/A)

## Infrastructure (completed)

- [x] Append-only JSONL changelog with hash-chain verification
- [x] 5 Gemini subagents (code_review, security_audit, arch_review, doc_sync, cleanup)
- [x] MCP tools: run_subagent, run_maintenance, view_changelog, verify_changelog
- [x] Changelog viewer at /changelog.html
- [x] Daily cron maintenance (6 AM UTC)
- [x] Both repos synced and pushed

## 2026-04-13 session — security hardening + auth overhaul + mem0 stack

### Completed this session

- [x] **SEC-CRIT-1: Shell injection in subagents.js** — `commits` now parseInt-clamped 1-50; git flag can't escape
- [x] **SEC-CRIT-2: Path traversal in security_audit** — `safeRead()` validates all paths stay within REPO via path.resolve
- [x] **SEC-WARN-1: Custom esc() XSS hardening** — added single-quote escaping (`&#39;`)
- [x] **SEC-WARN-2: unsafe-inline removed from CSP style-src** — all inline styles replaced with CSS classes (.dm-*, .u-crit/hot/warn/cool, .attr-blocked)
- [x] **SEC-WARN-3: SQLite PATCH fields documented** — hardcoded allowlist, confirmed no injection risk
- [x] **SEC-INFO-1: HSTS header** — `max-age=31536000; includeSubDomains` via nginx `add_header always`
- [x] **SEC-INFO-2: TLS 1.2 disabled** — `ssl_protocols TLSv1.3` override after letsencrypt include
- [x] **SEC-INFO-3: nginx version disclosure** — `server_tokens off`
- [x] **AUTH-1: Session cookie auth** — replaced nginx Basic Auth with Express cookie sessions (HMAC-SHA256, Secure/HttpOnly/SameSite=Strict, 30-day)
- [x] **AUTH-2: Login/logout pages** — `GET /login` form, `POST /login` validates via `htpasswd -v -i`, `GET /logout` clears cookie
- [x] **AUTH-3: 401 → /login redirect in app.js** — api() redirects browser to /login on 401 response
- [x] **AUTH-4: Sign out button** — added to header nav in app.js
- [x] **FEAT-1: task_events audit log** — new table + indexes; logged on create/done/undone/archive/unarchive
- [x] **FEAT-2: Gemini scheduling context** — last 30 days of task_events included in Gemini agent prompt
- [x] **INFRA-1: Mem0 memory stack** — postgres + qdrant + mem0 via docker compose on localhost:8000
- [x] **INFRA-2: MCP v2.2.0** — memory_add/search/list/delete tools backed by Mem0 REST API
- [x] **INFRA-3: Gemini model update** — gemini-3-flash-preview (text), gemini-embedding-001 (768-dim)
- [x] **INFRA-4: SSH key injection** — cyan@yardang ed25519 key in /root/.ssh/authorized_keys

### Still open

- [x] **V1: FAB overlaps timeline cards** — padding-bottom fixed
- [x] **V2: Cards clipped at right edge** — grid split optimized
- [x] **V3: BLOCKED label low contrast** — Canyon Red border applied
- [x] **V4: Leader-line arrows overlap cards** — N/A
- [x] **S3: /api/users unauthenticated** — restricted to self-only
- [x] **U1: No keyboard navigation for cards** — tabindex=0 implemented
- [x] **U2: No focus trap in modals** — Tab loop implemented
- [x] **CLEAN-10: CDN fallback** — Local vendor scripts added
