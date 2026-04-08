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

```
read_file /opt/organizer/repo/public/index.html
```

You now have full context: architecture, schema, API, all routes, and live task state. Make changes → commit → deploy.
