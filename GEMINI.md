# GEMINI.md — 7ay.de Organizer App

Auto-loaded by Gemini CLI when run from this repo. Read before making changes.

## Setup (local)

Your `.gemini/settings.json` (repo root) must point to the external MCP URL, not localhost:

    {
      "mcpServers": {
        "organizer": {
          "url": "https://7ay.de/mcp/sse?token=7f9d45a0ac60924936bfdd2c078678fb07f5d8951a58110015b77a336ab0e07a"
        }
      }
    }

The server-side `.gemini/settings.json` uses `http://localhost:3002/...` — don't copy that one.

---

## How to Work on This

You have two modes:

**Mode A — edit locally, push to deploy**
Edit files in your local clone. Test with `node --check server.js`. Push to deploy:

    git add -A && git commit -m "feat: ..." && git push origin main

The `post-receive` hook on the server restarts the app automatically.

**Mode B — edit on server via MCP tools**
Use `write_file` / `bash` MCP tools to edit files directly on the server at `/opt/organizer/repo/`.
Then use `git_commit_push` to commit. Useful for quick fixes or when you need live state context.

Both modes are valid. For anything touching the MCP server itself (`mcp-server/`), Mode B is easier since you can restart and verify in the same session.

---

## Orientation

Get live state via MCP tools at session start:

    db_query: SELECT id,user_id,domain,name,done,archived FROM tasks WHERE archived=0 ORDER BY user_id,sort_order;
    bash: git -C /opt/organizer/repo log --oneline -10
    bash: systemctl is-active organizer organizer-mcp organizer-commit

Read the full architecture doc:

    read_file: /opt/organizer/repo/project-context.yaml

---

## Architecture

    Browser -HTTPS-> Nginx (443) at 7ay.de / 164.92.90.91
      +-- /mcp        -> localhost:3002  (MCP SSE + A2A — this is how Gemini CLI connects)
      +-- /api/commit -> localhost:3001  (commit daemon, server-local only)
      +-- /           -> localhost:3000  (Express app)

Key server paths:
  /opt/organizer/repo/server.js           Express API + session auth
  /opt/organizer/repo/public/app.js       Vanilla JS SPA
  /opt/organizer/repo/public/index.html   HTML shell
  /opt/organizer/repo/public/style.css    All CSS
  /opt/organizer/mcp-server/server.js     MCP server (port 3002, separate process)
  /opt/organizer/mcp-server/subagents.js  Gemini subagents
  /opt/organizer/mcp-server/changelog.js  Append-only JSONL audit log
  /opt/organizer/data/organizer.db        SQLite WAL database
  /opt/organizer/data/.session_secret     HMAC secret — DO NOT LOG OR MODIFY
  /etc/nginx/sites-available/organizer    Nginx config

Services:
  organizer.service        deploy  3000  main app
  organizer-mcp.service    root    3002  MCP + A2A (your connection goes through here)
  organizer-commit.service root    3001  git commit daemon

Database: SQLite WAL, foreign_keys ON, raw better-sqlite3. No ORM.
Tables: users, tasks, subtasks, blockers, ui_state, task_events.
Backup: cron every 7min -> /opt/organizer/data/backups/

---

## CRITICAL SAFETY RULES

DO NOT:
1. Modify nginx config without: bash: nginx -t && systemctl reload nginx
2. Edit mcp-server/ while organizer-mcp is mid-restart (you'll lose your MCP connection)
3. Touch /opt/organizer/data/.session_secret — invalidates all active sessions
4. Modify /opt/organizer/bare.git/ directly — bare remote, hooks run on push
5. Run schema-destructive SQL without a dump checkpoint first
6. Use apt for packages — npm for Node deps only
7. Change MCP_AUTH_TOKEN in organizer-mcp.service without updating your local .gemini/settings.json AND the server-side one
8. Hand-edit package-lock.json — use npm install / npm ci

Safe restarts (via MCP service_control tool):
  organizer           ~1s downtime, nginx buffers it
  organizer-commit    commit daemon only, no user impact

Careful:
  organizer-mcp       drops your MCP SSE connection — you'll need to reconnect
    check active connections first: bash: ss -tnp | grep 3002

---

## Workflows

### App change (server.js or public/)

    # Option A: local edit + push
    node --check server.js          # syntax check locally
    git add -A && git commit -m "feat: ..." && git push origin main
    # post-receive restarts organizer automatically

    # Option B: via MCP
    write_file /opt/organizer/repo/server.js  <new content>
    bash: node --check /opt/organizer/repo/server.js
    bash: systemctl restart organizer
    bash: curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login
    git_commit_push

### MCP server change (mcp-server/)

    # Mode B only (needs restart + verify on server)
    write_file /opt/organizer/mcp-server/server.js  <content>
    bash: node --check /opt/organizer/mcp-server/server.js
    bash: systemctl restart organizer-mcp
    # NOTE: restarting organizer-mcp drops your connection — reconnect after
    bash: TOKEN=$(systemctl show organizer-mcp --property=Environment | grep -oP '(?<=MCP_AUTH_TOKEN=)\S+') && curl -s --max-time 3 "http://127.0.0.1:3002/mcp/sse?token=$TOKEN" | head -1
    git_commit_push

### Nginx change

    # Always test first
    bash: nginx -t && systemctl reload nginx
    # Rollback:
    bash: cp /opt/organizer/infra/nginx-organizer.conf /etc/nginx/sites-available/organizer && nginx -t && systemctl reload nginx

---

## Security Patterns — Do Not Break

Session: HMAC-signed sid cookie (slug.ts.hmac), secret in data/.session_secret, 30-day expiry.
  All routes use ensureAuth middleware.

CSRF: All non-GET requests require X-Requested-With: XMLHttpRequest. Do not remove.

Ownership: New task endpoints MUST use requireTaskOwner / requireSubtaskOwner.

Domain allowlist: VALID_DOMAINS = ['CTI','ECM','CSD','GRA','Personal'].
  Adding a domain = update server.js AND project-context.yaml.

X-Auth-User: Injected by nginx from basic auth, client-supplied value stripped. Don't touch.

CSP: External scripts from cdnjs.cloudflare.com only. No inline scripts — all JS in public/app.js.

---

## Database Operations (via MCP db_query or bash)

    db_query: SELECT ...                 # read-only, safe
    bash: sqlite3 /opt/organizer/data/organizer.db "SELECT ..."

    # Before any schema change — checkpoint backup first
    bash: sqlite3 /opt/organizer/data/organizer.db ".dump" > /opt/organizer/data/backups/pre-change-$(date +%s).sql

    bash: sqlite3 /opt/organizer/data/organizer.db "PRAGMA integrity_check; PRAGMA wal_checkpoint(TRUNCATE);"

Schema reference (also in your local clone): schema.sql

---

## Git & Deployment

Local push -> origin main -> bare.git post-receive hook:
  1. Checks out to /opt/organizer/repo/
  2. npm ci --omit=dev if package-lock.json changed
  3. systemctl restart organizer

Inspect hook: read_file /opt/organizer/bare.git/hooks/post-receive
Manual deploy if hook fails: bash: cd /opt/organizer/repo && git pull && systemctl restart organizer
Auto-sync commits (maintenance: daily auto-sync) every 7min are harmless — don't revert.

---

## MCP Tools Available

Connected via .gemini/settings.json -> https://7ay.de/mcp/sse?token=...

  bash                        run commands on the server
  read_file / write_file / list_files / delete_file
  db_query                    read-only SQLite
  git_status / git_commit_push
  deploy                      rebuild + restart app
  memory_add/search/list/delete
  kb_add/search/ingest_url/export
  logs                        journalctl output
  nginx_reload                safe (runs nginx -t first)
  service_control             start/stop/restart allowed services
  run_subagent                code_review|security_audit|arch_review|doc_sync|cleanup
  view_changelog / verify_changelog
  sysinfo / docker_status / net_listeners

---

## Memory / Knowledge Base

Mem0 stack on server: postgres + qdrant + mem0 at localhost:8000 (server-local, not exposed externally)
Health: bash: curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/v1/memories/
Scripts: scripts/kb.py, scripts/post-session-kb.sh (run after dev sessions via MCP bash)

---

## Do Not Touch (Unrelated, Same Server)

  /opt/sitl_env/   ArduPilot SITL drone research
  /opt/vuln_scaf/  Vulnerability research
  /opt/mem0/       Mem0 stack config (don't edit compose)
  /var/www/html/   Unrelated static files
  /root/.gemini/   Global Gemini CLI server-side config

---

## Subagents

After significant changes, dispatch via MCP run_subagent tool or:

    bash: cd /opt/organizer/repo && npx @google/gemini-cli --yolo -p "Run a security_audit subagent on recent changes to server.js"

  code_review     code quality + standards
  security_audit  vuln check, security regressions
  arch_review     split-file SPA/Express alignment
  doc_sync        sync project-context.yaml + README.md
  cleanup         dead code, temp files, stale artifacts
