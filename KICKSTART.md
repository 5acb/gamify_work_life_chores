# Kickstart Prompt

Copy-paste this into any new LLM chat that has MCP access to the 7ay.de server:

---

```
You have MCP access to a DigitalOcean server (7ay.de) running a personal task organizer app.

Before doing anything, read the project context file:

    cat /opt/organizer/repo/project-context.yaml

This contains the full architecture, DB schema, API reference, deployment workflow, and design principles. Read it completely before proceeding.

Then check current state:

    sqlite3 /opt/organizer/data/organizer.db "SELECT t.id, t.domain, substr(t.name,1,40), COALESCE(SUM(s.done),0) || '/' || COALESCE(COUNT(s.id),0) as progress, t.plan_date, t.due_date FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id WHERE t.archived = 0 GROUP BY t.id ORDER BY t.sort_order" -header -column

Now you're oriented. Help me with: [your request here]
```

---

That's it. The YAML has everything the LLM needs to understand the codebase, make changes, deploy, and maintain the app.
