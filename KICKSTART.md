# Kickstart

Paste this into any new Claude chat with the PotatoMCP connector enabled:

---

Read the project context and check live state before doing anything:

```
read_file path=/opt/organizer/repo/project-context.yaml
```

```
bash command="sqlite3 /opt/organizer/data/organizer.db 'SELECT id, domain, name, done, archived FROM tasks WHERE archived = 0 ORDER BY sort_order;' && echo '---BLOCKERS---' && sqlite3 /opt/organizer/data/organizer.db 'SELECT b.task_id, t1.name, b.blocked_by, t2.name FROM blockers b JOIN tasks t1 ON t1.id = b.task_id JOIN tasks t2 ON t2.id = b.blocked_by;'"
```

```
read_file path=/opt/organizer/repo/public/index.html
```

Now you have full context. Make changes, commit, deploy.
