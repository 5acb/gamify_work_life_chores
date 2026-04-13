# Kickstart

Paste into any new Claude chat with the **PotatoMCP connector** enabled:

---

```
read_file /opt/organizer/repo/project-context.yaml
```

```
bash sqlite3 /opt/organizer/data/organizer.db 'SELECT id,user_id,domain,name,done,archived FROM tasks WHERE archived=0 ORDER BY user_id,sort_order;' && sqlite3 /opt/organizer/data/organizer.db 'SELECT b.task_id,t1.name,b.blocked_by,t2.name FROM blockers b JOIN tasks t1 ON t1.id=b.task_id JOIN tasks t2 ON t2.id=b.blocked_by;'
```

```
read_file /opt/organizer/repo/server.js
```

You now have full context: architecture, schema, API, all routes, and live task state.

## Key facts for new sessions

- **Auth:** cookie-based (`sid`), HMAC-signed. Login at `GET /login`, form `POST /login`, logout `GET /logout`. Passwords in `/etc/nginx/.htpasswd` (apr1-md5). Session secret in `/opt/organizer/data/.session_secret`.
- **Memory stack (Mem0):** `docker compose -f /opt/mem0/docker-compose.yml` — postgres + qdrant + mem0 on `localhost:8000`. API key in `/opt/mem0/.env`.
- **MCP server:** v2.2.0 at `/opt/organizer/mcp-server/server.js`, systemd `organizer-mcp.service`, SSE on `localhost:3002`, proxied at `/mcp`. Has `memory_add/search/list/delete` tools backed by Mem0.
- **Gemini model:** `gemini-3-flash-preview` (text), `gemini-embedding-001` (768-dim embeddings).
- **DB:** `/opt/organizer/data/organizer.db` — tasks, subtasks, blockers, ui_state, task_events.
- **Nginx:** TLS 1.3 only, HSTS 1yr, `server_tokens off`. Config at `/etc/nginx/sites-available/organizer`.

Make changes → commit → `git push` → deploy.
