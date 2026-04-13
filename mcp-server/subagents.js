// ── Gemini Subagent Framework ─────────────────────────────────
// Specialized Gemini agents with focused system prompts.
// Each subagent reads only what it needs and writes structured output.
// The dispatcher logs everything to the changelog.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import { logEvent } from "./changelog.js";

const REPO = "/opt/organizer/repo";
const DB   = "/opt/organizer/data/organizer.db";

function run(cmd, cwd = REPO) {
  try { return execSync(cmd, { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 5e6 }).trim(); }
  catch { return ""; }
}

// Safe file reader — rejects paths that escape REPO
function safeRead(relPath) {
  const abs = resolve(REPO, relPath.replace(/^\.\//, ""));
  if (!abs.startsWith(REPO + "/") && abs !== REPO) return "";
  try { return readFileSync(abs, "utf-8").slice(0, 3000); }
  catch { return ""; }
}

// ── Subagent definitions ──────────────────────────────────────

export const SUBAGENTS = {
  code_review: {
    description: "Reviews recent commits for bugs, logic errors, and code quality issues",
    buildPrompt: ({ commits = 5 } = {}) => {
      // SEC: clamp to integer 1-50 to prevent shell injection via git flag
      const n = Math.max(1, Math.min(50, parseInt(commits, 10) || 5));
      const log = run(`git log --oneline -${n}`);
      const diff = run(`git diff HEAD~${Math.min(n, 5)}..HEAD -- '*.js' '*.json' '*.yaml' '*.html' '*.css' '*.sh'`);
      return `You are a senior code reviewer. Review the following recent changes for:
- Bugs and logic errors
- Security issues (hardcoded secrets, injection, unsafe evals)
- Performance problems
- Code style inconsistencies
- Missing error handling

Recent commits:\n${log}\n\nDiff:\n${diff.slice(0, 15000)}

Output a concise report with:
1. CRITICAL issues (must fix)
2. WARNINGS (should fix)
3. SUGGESTIONS (nice to have)
If everything looks good, say so briefly.`;
    },
  },

  security_audit: {
    description: "Scans codebase for security issues: secrets, permissions, dependency vulns, misconfigs",
    buildPrompt: () => {
      const files = run(`find . -type f \\( -name '*.js' -o -name '*.json' -o -name '*.yaml' -o -name '*.sh' -o -name '*.conf' \\) -not -path '*/node_modules/*' -not -path '*/.git/*' | head -30`);
      // SEC: safeRead validates each path stays within REPO before reading
      const contents = files.split("\n").filter(Boolean).map(f => {
        const content = safeRead(f);
        return content ? `── ${f} ──\n${content}` : "";
      }).filter(Boolean).join("\n\n");
      const npmAudit = run(`npm audit --json 2>/dev/null | head -100 || echo "{}"`);
      const perms = run(`ls -la ${REPO}/scripts/ 2>/dev/null; ls -la /opt/organizer/scripts/ 2>/dev/null; cat /etc/sudoers.d/gemini-ask 2>/dev/null`);

      return `You are a security auditor for a personal server (7ay.de, Ubuntu 24, Node.js app with SQLite).
Scan for:
- Hardcoded secrets, tokens, passwords
- SQL injection risks (especially in sqlite3 shell calls)
- Unsafe file operations (path traversal)
- Overly permissive sudoers or file permissions
- npm dependency vulnerabilities
- Nginx/systemd misconfigs

Files:\n${contents.slice(0, 20000)}

npm audit:\n${npmAudit.slice(0, 2000)}

Permissions:\n${perms}

Output: CRITICAL / WARNING / INFO findings. Be specific about file + line.`;
    },
  },

  arch_review: {
    description: "Reviews architecture and suggests structural improvements",
    buildPrompt: () => {
      let yaml = "";
      try { yaml = readFileSync(`${REPO}/project-context.yaml`, "utf-8"); } catch {}
      const tree = run(`find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -50`);
      return `You are a software architect reviewing a personal organizer app.
Architecture doc:\n${yaml.slice(0, 8000)}

File tree:\n${tree}

Review for:
- Separation of concerns (is the Express server doing too much?)
- Scalability issues
- Missing abstractions
- Inconsistent patterns
- Opportunities to simplify

Be practical — this is a solo dev project on a $12/mo droplet, not a microservices enterprise. Focus on maintainability.
Output: concrete, actionable suggestions ranked by impact.`;
    },
  },

  doc_sync: {
    description: "Updates project-context.yaml and KICKSTART.md to match current codebase state",
    buildPrompt: () => {
      let yaml = "";
      try { yaml = readFileSync(`${REPO}/project-context.yaml`, "utf-8"); } catch {}
      const tree = run(`find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sort`);
      const serverHead = readFileSync(`${REPO}/server.js`, "utf-8").slice(0, 4000);
      const mcpHead = readFileSync(`/opt/organizer/mcp-server/server.js`, "utf-8").slice(0, 4000);
      const schema = run(`sqlite3 ${DB} ".schema" 2>/dev/null`);
      const services = run(`systemctl list-units --type=service --state=running | grep organizer`);

      return `You are a documentation maintainer. Update the project-context.yaml to accurately reflect the current state.

Current YAML:\n${yaml.slice(0, 6000)}

Current file tree:\n${tree}

server.js (head):\n${serverHead}

MCP server.js (head):\n${mcpHead}

DB schema:\n${schema}

Running services:\n${services}

Output ONLY the complete updated YAML content — no explanation, no code fences. Keep the same structure and style. Add any new sections needed (e.g. changelog, subagents). Remove anything that's no longer accurate.`;
    },
    postProcess: async (response) => {
      const yaml = response.replace(/^```ya?ml\n?/i, "").replace(/\n?```\s*$/, "").trim();
      if (yaml.length > 200 && (yaml.includes("architecture") || yaml.includes("schema") || yaml.includes("organizer"))) {
        writeFileSync(`${REPO}/project-context.yaml`, yaml + "\n");
        return { wrote: "project-context.yaml", bytes: yaml.length };
      }
      return { skipped: true, reason: "Response didn't look like valid YAML" };
    },
  },

  cleanup: {
    description: "Identifies dead code, TODOs, inconsistent naming, unused files",
    buildPrompt: () => {
      const todos = run(`grep -rn "TODO\\|FIXME\\|HACK\\|XXX" --include='*.js' --include='*.html' 2>/dev/null | head -30`);
      const tree = run(`find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sort`);
      const serverJs = readFileSync(`${REPO}/server.js`, "utf-8");

      return `You are a code cleanup assistant. Analyze for:
- Dead/unreachable code
- Unresolved TODOs: ${todos || "(none found)"}
- Unused files or exports
- Inconsistent naming conventions
- Duplicate logic
- Overly complex functions that should be split

File tree:\n${tree}

server.js:\n${serverJs.slice(0, 12000)}

Output: a prioritized cleanup checklist. For each item, specify file + what to do.`;
    },
  },
};

/**
 * Run a named subagent.
 */
export async function runSubagent(name, geminiInvoke, opts = {}, parentEventId = null) {
  const agent = SUBAGENTS[name];
  if (!agent) throw new Error(`Unknown subagent: ${name}. Available: ${Object.keys(SUBAGENTS).join(", ")}`);

  const startEvent = logEvent({
    agent_id: `gemini:${name}`,
    action_type: "subagent",
    action_detail: { subagent: name, status: "started", opts },
    outcome: "started",
    parent_id: parentEventId,
  });

  try {
    const prompt = agent.buildPrompt(opts);
    const result = await geminiInvoke(prompt, { timeout: 120000 });

    let postResult = null;
    if (agent.postProcess) {
      postResult = await agent.postProcess(result.response, geminiInvoke);
    }

    const endEvent = logEvent({
      agent_id: `gemini:${name}`,
      action_type: "subagent",
      action_detail: {
        subagent: name,
        status: "completed",
        model: result.model,
        tokens: result.tokens,
        response_length: result.response?.length,
        post_process: postResult,
      },
      outcome: "success",
      parent_id: startEvent.id,
    });

    return { response: result.response, model: result.model, event: endEvent, postResult };
  } catch (err) {
    logEvent({
      agent_id: `gemini:${name}`,
      action_type: "subagent",
      action_detail: { subagent: name, status: "error", error: err.message },
      outcome: "error",
      parent_id: startEvent.id,
    });
    throw err;
  }
}
