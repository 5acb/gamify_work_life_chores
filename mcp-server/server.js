import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { logEvent, readChangelog, verifyChain } from "./changelog.js";
import { SUBAGENTS, runSubagent } from "./subagents.js";

const REPO = "/opt/organizer/repo";
const DB   = "/opt/organizer/data/organizer.db";
const AUTH_TOKEN          = process.env.MCP_AUTH_TOKEN || "";
const GEMINI_API_KEY      = process.env.GEMINI_API_KEY || "";
const GEMINI_DEFAULT_MODEL = "gemini-3-flash-preview";
const MEM0_URL            = process.env.MEM0_URL || "http://localhost:8000";
const MEM0_API_KEY        = process.env.MEM0_API_KEY || "";
const PORT = 3002;

function runCmd(cmd, cwd = REPO, timeout = 30000) {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout, maxBuffer: 5 * 1024 * 1024 }).trim();
  } catch (e) {
    return `ERROR (exit ${e.status}): ${e.stderr || e.message}`;
  }
}

// ── Gemini helpers ────────────────────────────────────────────

async function geminiInvoke(prompt, { timeout = 60000, model } = {}) {
  const resolvedModel = model || GEMINI_DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || JSON.stringify(data.error || data);
      return { response: `Gemini API error (${res.status}): ${msg}`, model: resolvedModel, tokens: null };
    }
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join("") || "";
    const usage = data.usageMetadata;
    const tokens = usage ? (usage.totalTokenCount || usage.promptTokenCount + usage.candidatesTokenCount) : null;
    return { response: text, model: resolvedModel, tokens };
  } catch (err) {
    if (err.name === "AbortError") return { response: "Gemini timed out", model: resolvedModel, tokens: null };
    return { response: `Gemini error: ${err.message}`, model: resolvedModel, tokens: null };
  } finally {
    clearTimeout(timer);
  }
}

async function geminiAgentInvoke(prompt, { cwd = "/tmp", timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const args = ["@google/gemini-cli", "--yolo", "--output-format", "json", "-p", ""];
    let stdout = "", stderr = "";
    const child = spawn("npx", args, {
      cwd,
      env: { ...process.env, HOME: "/root" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ response: "Gemini agent timed out (CLI).", model: null });
    }, timeout);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const start = stdout.indexOf("{");
        if (start === -1) return resolve({ response: stdout || stderr.slice(0, 500), model: null });
        const parsed = JSON.parse(stdout.slice(start));
        resolve({
          response: parsed.response || "",
          model: Object.keys(parsed.stats?.models || {})[0] || null,
          tokens: parsed.stats?.models ? Object.values(parsed.stats.models)[0]?.tokens?.total : null,
        });
      } catch {
        resolve({ response: stdout, model: null });
      }
    });
  });
}

// ── Mem0 memory helper ────────────────────────────────────────

async function mem0(method, path, body = null) {
  const res = await fetch(`${MEM0_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(MEM0_API_KEY ? { "X-API-Key": MEM0_API_KEY } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mem0 ${method} ${path} → ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

// ── Nano Banana image generation ──────────────────────────────

const NB_MODELS = {
  free:  "gemini-2.5-flash-image",
  nb2:   "gemini-3.1-flash-image-preview",
  nbpro: "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image":         "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview":     "gemini-3-pro-image-preview",
};

async function generateImage(prompt, model = "gemini-2.5-flash-image") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["image", "text"] },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data.error || data));
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData);
  const textPart = parts.find(p => p.text);
  if (!imgPart) throw new Error(`No image in response. Text: ${textPart?.text || JSON.stringify(data)}`);
  const outDir = "/tmp/nb_images";
  mkdirSync(outDir, { recursive: true });
  const fname = `${outDir}/nb_${Date.now()}.png`;
  writeFileSync(fname, Buffer.from(imgPart.inlineData.data, "base64"));
  return { path: fname, base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType, text: textPart?.text || "", model };
}

function getTaskContext(slug = "anas") {
  const today = new Date().toISOString().split("T")[0];
  const tasks = runCmd(
    `sqlite3 ${DB} "SELECT t.id,t.domain,t.name,t.speed,t.stakes,t.done,t.plan_date,t.due_date FROM tasks t JOIN users u ON u.id=t.user_id WHERE u.slug='${slug}' AND t.archived=0 ORDER BY t.sort_order;"`,
    "/tmp", 8000
  );
  const blockers = runCmd(
    `sqlite3 ${DB} "SELECT b.task_id,t1.name,b.blocked_by,t2.name FROM blockers b JOIN tasks t1 ON t1.id=b.task_id JOIN tasks t2 ON t2.id=b.blocked_by;"`,
    "/tmp", 8000
  );
  const subtasks = runCmd(
    `sqlite3 ${DB} "SELECT s.task_id,s.label,s.done FROM subtasks s JOIN tasks t ON t.id=s.task_id JOIN users u ON u.id=t.user_id WHERE u.slug='${slug}' AND t.archived=0 ORDER BY s.task_id,s.sort_order;"`,
    "/tmp", 8000
  );
  return [
    `Today: ${today}`,
    `Speed legend: 0=snap(quick), 1=sesh(medium), 2=grind(long)`,
    `Stakes legend: 0=low, 1=high, 2=crit`,
    `\nTasks for ${slug} (id|domain|name|speed|stakes|done|plan_date|due_date):\n${tasks || "(none)"}`,
    blockers ? `\nBlockers (task_id|task_name|blocked_by_id|blocked_by_name):\n${blockers}` : "",
    subtasks ? `\nSubtasks (task_id|label|done):\n${subtasks}` : "",
  ].filter(Boolean).join("\n");
}

// ── Express / SSE setup ───────────────────────────────────────

const app = express();
const sessions = {};

app.get("/mcp/sse", (req, res) => {
  if (AUTH_TOKEN && req.query.token !== AUTH_TOKEN) return res.status(401).json({ error: "unauthorized" });
  const transport = new SSEServerTransport("/mcp/messages", res);
  sessions[transport.sessionId] = transport;
  console.log(`Session created: ${transport.sessionId}`);
  res.on("close", () => { delete sessions[transport.sessionId]; console.log(`Session closed: ${transport.sessionId}`); });
  const server = createMcpServer();
  server.connect(transport).catch(err => console.error("Connect error:", err));
});

app.post("/mcp/messages", (req, res) => {
  const transport = sessions[req.query.sessionId];
  if (!transport) return res.status(404).json({ error: "session not found" });
  transport.handlePostMessage(req, res).catch(err => {
    console.error("handlePostMessage error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

app.get("/api/changelog", (req, res) => {
  const { tail, agent_id, action_type, since, search } = req.query;
  const entries = readChangelog({ tail: tail ? parseInt(tail) : 50, agent_id, action_type, since, search });
  res.json({ entries, total: entries.length });
});

app.get("/api/changelog/verify", (req, res) => res.json(verifyChain()));

app.post("/api/agent/gemini", express.json(), async (req, res) => {
  const { question, user } = req.body;
  if (!question) return res.status(400).json({ error: "question required" });
  const slug = user || "anas";
  const ctx = getTaskContext(slug);
  const prompt = `You are a productivity assistant for ${slug}. Here is their current task state:\n\n${ctx}\n\nAnswer concisely and practically:\n${question}`;
  logEvent({ agent_id: "gemini", action_type: "api_mutation", action_detail: { endpoint: "/api/agent/gemini", question, user: slug }, outcome: "started" });
  try {
    const result = await geminiInvoke(prompt, { timeout: 90000 });
    logEvent({ agent_id: "gemini", action_type: "api_mutation", action_detail: { endpoint: "/api/agent/gemini", model: result.model, tokens: result.tokens }, outcome: "success" });
    res.json({ response: result.response, model: result.model });
  } catch (err) {
    logEvent({ agent_id: "gemini", action_type: "api_mutation", action_detail: { endpoint: "/api/agent/gemini", error: err.message }, outcome: "error" });
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/agent/subagent", express.json(), async (req, res) => {
  const { name, opts } = req.body;
  if (!name || !SUBAGENTS[name]) return res.status(400).json({ error: `Unknown subagent. Available: ${Object.keys(SUBAGENTS).join(", ")}` });
  try {
    const result = await runSubagent(name, geminiInvoke, opts || {});
    res.json({ response: result.response, model: result.model, postResult: result.postResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MCP tools ─────────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({ name: "organizer-server", version: "2.2.0" });

  function loggedTool(name, desc, schema, handler) {
    server.tool(name, desc, schema, async (params, extra) => {
      const evt = logEvent({ agent_id: "claude", action_type: "tool_call", action_detail: { tool: name, args: truncateArgs(params) }, outcome: "started" });
      try {
        const result = await handler(params, extra);
        logEvent({ agent_id: "claude", action_type: "tool_call", action_detail: { tool: name, result_length: result?.content?.[0]?.text?.length }, outcome: "success", parent_id: evt.id });
        return result;
      } catch (err) {
        logEvent({ agent_id: "claude", action_type: "tool_call", action_detail: { tool: name, error: err.message }, outcome: "error", parent_id: evt.id });
        throw err;
      }
    });
  }

  function truncateArgs(args) {
    const out = {};
    for (const [k, v] of Object.entries(args)) out[k] = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "..." : v;
    return out;
  }

  // ── Shell / file tools ──

  loggedTool("bash", "Run a shell command on the server",
    { command: z.string(), cwd: z.string().optional(), timeout: z.number().optional() },
    async ({ command, cwd, timeout }) => ({ content: [{ type: "text", text: runCmd(command, cwd || REPO, timeout || 30000) }] }));

  loggedTool("read_file", "Read a file from the server",
    { path: z.string() },
    async ({ path: p }) => {
      const abs = p.startsWith("/") ? p : join(REPO, p);
      try { return { content: [{ type: "text", text: readFileSync(abs, "utf-8") }] }; }
      catch (e) { return { content: [{ type: "text", text: `ERROR: ${e.message}` }] }; }
    });

  loggedTool("write_file", "Write/create a file on the server",
    { path: z.string(), content: z.string() },
    async ({ path: p, content }) => {
      const abs = p.startsWith("/") ? p : join(REPO, p);
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, "utf-8");
        return { content: [{ type: "text", text: `Written: ${abs} (${content.length} bytes)` }] };
      } catch (e) { return { content: [{ type: "text", text: `ERROR: ${e.message}` }] }; }
    });

  loggedTool("list_files", "List directory contents",
    { path: z.string().optional(), recursive: z.boolean().optional() },
    async ({ path: p, recursive }) => {
      const abs = p ? (p.startsWith("/") ? p : join(REPO, p)) : REPO;
      try {
        const entries = [];
        function walk(dir, prefix = "") {
          for (const entry of readdirSync(dir)) {
            if (entry === "node_modules" || entry === ".git") continue;
            const full = join(dir, entry);
            const st = statSync(full);
            const rel = prefix ? `${prefix}/${entry}` : entry;
            entries.push(`${st.isDirectory() ? "d" : "-"} ${rel}${st.isDirectory() ? "" : ` (${st.size}b)`}`);
            if (recursive && st.isDirectory()) walk(full, rel);
          }
        }
        walk(abs);
        return { content: [{ type: "text", text: entries.join("\n") || "(empty)" }] };
      } catch (e) { return { content: [{ type: "text", text: `ERROR: ${e.message}` }] }; }
    });

  loggedTool("delete_file", "Delete a file",
    { path: z.string() },
    async ({ path: p }) => {
      const abs = p.startsWith("/") ? p : join(REPO, p);
      try { unlinkSync(abs); return { content: [{ type: "text", text: `Deleted: ${abs}` }] }; }
      catch (e) { return { content: [{ type: "text", text: `ERROR: ${e.message}` }] }; }
    });

  // ── Git / deploy tools ──

  loggedTool("git_status", "Show git status", {},
    async () => {
      const status = runCmd("git status --short");
      const branch = runCmd("git branch --show-current");
      const log = runCmd("git log --oneline -5");
      return { content: [{ type: "text", text: `Branch: ${branch}\nStatus:\n${status || "(clean)"}\nRecent:\n${log}` }] };
    });

  loggedTool("git_commit_push", "Stage all, commit, push to GitHub",
    { message: z.string().optional() },
    async ({ message }) => {
      const msg = message || `auto: ${new Date().toISOString()}`;
      runCmd("git add -A");
      const diff = runCmd("git diff --cached --stat");
      if (!diff) return { content: [{ type: "text", text: "Nothing to commit" }] };
      runCmd(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
      const pushOut = runCmd("git push github main 2>&1 || echo 'no remote or push failed'");
      const hash = runCmd("git rev-parse --short HEAD");
      return { content: [{ type: "text", text: `${hash}: ${msg}\n${diff}\n${pushOut}` }] };
    });

  loggedTool("deploy", "Rebuild and restart the app", {},
    async () => {
      const out = [];
      if (existsSync(join(REPO, "package.json"))) {
        out.push(runCmd("npm install --omit=dev 2>&1", REPO, 60000));
        const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf-8"));
        if (pkg.scripts?.build) out.push(runCmd("npm run build 2>&1", REPO, 120000));
      }
      out.push(runCmd("sudo systemctl restart organizer 2>&1 || echo 'restart failed'", REPO));
      return { content: [{ type: "text", text: out.join("\n") }] };
    });

  loggedTool("logs", "View service logs",
    { lines: z.number().optional(), service: z.string().optional() },
    async ({ lines, service }) => ({
      content: [{ type: "text", text: runCmd(`journalctl -u ${service || "organizer"} --no-pager -n ${lines || 50} 2>&1`) }]
    }));

  // ── Memory tools (Mem0) ──

  loggedTool("memory_add",
    "Store a memory in Mem0. Extracts facts from messages using Gemini 3 Flash and indexes them in Qdrant. Use to persist anything worth remembering across sessions.",
    {
      content: z.string().describe("The message or fact to remember"),
      user_id: z.string().optional().describe("User scope (default: anas)"),
      namespace: z.string().optional().describe("Logical grouping, stored as agent_id (e.g. mds-project, general)"),
    },
    async ({ content, user_id = "anas", namespace }) => {
      const body = {
        messages: [{ role: "user", content }],
        user_id,
        ...(namespace ? { agent_id: namespace } : {}),
      };
      const result = await mem0("POST", "/memories", body);
      const added = result.results?.filter(r => r.event === "ADD").length ?? 0;
      const updated = result.results?.filter(r => r.event === "UPDATE").length ?? 0;
      const summary = result.results?.map(r => `  [${r.event}] ${r.memory}`).join("\n") || JSON.stringify(result);
      return { content: [{ type: "text", text: `Stored ${added} new, ${updated} updated:\n${summary}` }] };
    });

  loggedTool("memory_search",
    "Semantic search over memories in Mem0. Returns ranked results with similarity scores.",
    {
      query: z.string().describe("What to search for"),
      user_id: z.string().optional().describe("User scope (default: anas)"),
      top_k: z.number().optional().describe("Max results (default: 5)"),
      namespace: z.string().optional().describe("Filter by agent_id/namespace"),
    },
    async ({ query, user_id = "anas", top_k = 5, namespace }) => {
      const body = {
        query,
        user_id,
        top_k,
        ...(namespace ? { filters: { agent_id: namespace } } : {}),
      };
      const result = await mem0("POST", "/search", body);
      if (!result.results?.length) return { content: [{ type: "text", text: "No memories found." }] };
      const lines = result.results.map((r, i) =>
        `${i + 1}. [${r.score?.toFixed(3) ?? "?"}] ${r.memory}${r.agent_id ? ` (${r.agent_id})` : ""}`
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    });

  loggedTool("memory_list",
    "List recent memories from Mem0, newest first.",
    {
      user_id: z.string().optional().describe("User scope (default: anas)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ user_id = "anas", limit = 20 }) => {
      const result = await mem0("GET", `/memories?user_id=${encodeURIComponent(user_id)}`);
      const memories = result.results ?? result ?? [];
      if (!memories.length) return { content: [{ type: "text", text: "No memories stored." }] };
      const lines = memories.slice(0, limit).map((r, i) =>
        `${i + 1}. [${r.id?.slice(0, 8)}] ${r.memory} — ${r.created_at?.slice(0, 10) ?? ""}`
      );
      return { content: [{ type: "text", text: `${lines.length} memories:\n${lines.join("\n")}` }] };
    });

  loggedTool("memory_delete",
    "Delete a specific memory by ID.",
    { memory_id: z.string().describe("Memory ID (from memory_list or memory_search)") },
    async ({ memory_id }) => {
      await mem0("DELETE", `/memories/${memory_id}`);
      return { content: [{ type: "text", text: `Deleted memory ${memory_id}` }] };
    });

  // ── Gemini tools ──

  loggedTool("ask_gemini", "Send a prompt to Gemini via REST API. Fast, no tool use.",
    { prompt: z.string(), model: z.string().optional() },
    async ({ prompt, model }) => {
      const result = await geminiInvoke(prompt, { model });
      const meta = result.model ? ` [${result.model}${result.tokens ? `, ${result.tokens} tokens` : ""}]` : "";
      return { content: [{ type: "text", text: result.response + (meta ? `\n\n---${meta}` : "") }] };
    });

  loggedTool("gemini_analyze_tasks", "Ask Gemini about current tasks with live DB context.",
    { question: z.string(), user: z.string().optional() },
    async ({ question, user }) => {
      const slug = user || "anas";
      const ctx = getTaskContext(slug);
      const prompt = `You are a productivity assistant for ${slug}. Here is their current task state:\n\n${ctx}\n\nAnswer concisely and practically:\n${question}`;
      const result = await geminiInvoke(prompt, { timeout: 90000 });
      return { content: [{ type: "text", text: result.response }] };
    });

  loggedTool("gemini_agent", "Run Gemini as autonomous agent with shell + MCP tools via CLI (--yolo). Slower (~30-60s).",
    { task: z.string(), timeout_ms: z.number().optional() },
    async ({ task, timeout_ms }) => {
      const result = await geminiAgentInvoke(task, { cwd: REPO, timeout: timeout_ms || 120000 });
      return { content: [{ type: "text", text: result.response }] };
    });

  loggedTool("run_subagent", "Run a specialized Gemini subagent (code_review, security_audit, arch_review, doc_sync, cleanup)",
    {
      name: z.enum(["code_review", "security_audit", "arch_review", "doc_sync", "cleanup"]),
      opts: z.record(z.any()).optional(),
    },
    async ({ name, opts }) => {
      const result = await runSubagent(name, geminiInvoke, opts || {});
      const meta = result.model ? `\n\n--- [${result.model}]` : "";
      const post = result.postResult ? `\nPost-process: ${JSON.stringify(result.postResult)}` : "";
      return { content: [{ type: "text", text: result.response + meta + post }] };
    });

  loggedTool("run_maintenance", "Run full maintenance suite: code_review → security_audit → cleanup → doc_sync.",
    {},
    async () => {
      const parentEvt = logEvent({ agent_id: "system", action_type: "maintenance", action_detail: { status: "started", suite: ["code_review", "security_audit", "cleanup", "doc_sync"] }, outcome: "started" });
      const results = {};
      for (const name of ["code_review", "security_audit", "cleanup", "doc_sync"]) {
        try {
          const r = await runSubagent(name, geminiInvoke, {}, parentEvt.id);
          results[name] = { status: "ok", response: r.response.slice(0, 3000), model: r.model };
        } catch (err) {
          results[name] = { status: "error", error: err.message };
        }
      }
      if (results.doc_sync?.status === "ok") {
        const diff = runCmd("git diff --stat", REPO);
        if (diff) {
          runCmd('git add -A && git commit -m "docs: auto-sync via maintenance suite"', REPO);
          runCmd("git push github main 2>&1", REPO);
          results._git = "doc changes committed and pushed";
        }
      }
      logEvent({ agent_id: "system", action_type: "maintenance", action_detail: { status: "completed", results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status])) }, outcome: "success", parent_id: parentEvt.id });
      return { content: [{ type: "text", text: Object.entries(results).map(([k, v]) => `## ${k}\n${v.status === "ok" ? v.response : `ERROR: ${v.error}`}`).join("\n\n") }] };
    });



  // ── SSL / nginx / system tools ──

  loggedTool("ssl_status", "Check TLS certificate expiry and renewal status via certbot.",
    {},
    async () => {
      const certs = runCmd("certbot certificates 2>&1", "/").trim();
      const expiry = runCmd("echo | openssl s_client -connect 7ay.de:443 -servername 7ay.de 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || true", "/").trim();
      return { content: [{ type: "text", text: `## Certbot\n${certs}\n\n## Live cert dates\n${expiry}` }] };
    });

  loggedTool("nginx_reload", "Test nginx config (nginx -t) and reload if valid. Pass dry_run=true to only test without reloading.",
    {
      dry_run: z.boolean().optional().describe("If true, only test config without reloading. Default: false"),
    },
    async ({ dry_run = false }) => {
      const test = runCmd("nginx -t 2>&1", "/").trim();
      if (dry_run || test.includes("failed")) {
        return { content: [{ type: "text", text: `## Config test\n${test}` }] };
      }
      const reload = runCmd("systemctl reload nginx 2>&1 && echo 'Reloaded OK'", "/").trim();
      return { content: [{ type: "text", text: `## Config test\n${test}\n\n## Reload\n${reload}` }] };
    });

  loggedTool("system_update", "Run apt update + upgrade + autoremove. Pass dry_run=true to only show available updates without installing.",
    {
      dry_run: z.boolean().optional().describe("If true, only list available updates. Default: false"),
    },
    async ({ dry_run = false }) => {
      const update = runCmd("apt update 2>&1 | tail -5", "/", 60000).trim();
      if (dry_run) {
        const available = runCmd("apt list --upgradable 2>/dev/null | tail -30", "/").trim();
        return { content: [{ type: "text", text: `## Update index\n${update}\n\n## Upgradable\n${available}` }] };
      }
      const upgrade = runCmd("DEBIAN_FRONTEND=noninteractive apt upgrade -y 2>&1 | tail -15", "/", 120000).trim();
      const autoremove = runCmd("apt autoremove -y 2>&1 | tail -5", "/", 60000).trim();
      return { content: [{ type: "text", text: `## Update\n${update}\n\n## Upgrade\n${upgrade}\n\n## Autoremove\n${autoremove}` }] };
    });

  loggedTool("net_listeners", "Show all listening TCP/UDP ports (ss -tlnp) and health-check known local services.",
    {},
    async () => {
      const listeners = runCmd("ss -tlnp", "/").trim();
      const checks = [
        ["organizer :3000", "curl -sf --max-time 2 http://127.0.0.1:3000/api/me 2>&1 | head -1 || echo 'no response'"],
        ["mcp :3002",       "curl -sf --max-time 2 http://127.0.0.1:3002/health 2>&1 | head -1 || echo 'no response'"],
        ["mem0 :8000",      "curl -sf --max-time 2 http://127.0.0.1:8000/docs 2>&1 | head -1 || echo 'no response'"],
        ["nginx :80",       "curl -sf --max-time 2 http://127.0.0.1/ -o /dev/null -w '%{http_code}' 2>&1 || echo 'no response'"],
        ["nginx :443",      "curl -sf --max-time 2 https://7ay.de/ -o /dev/null -w '%{http_code}' 2>&1 || echo 'no response'"],
      ];
      const healthLines = [];
      for (const [label, cmd] of checks) {
        const res = runCmd(cmd, "/", 5000).trim();
        healthLines.push(`${label.padEnd(20)} ${res}`);
      }
      return { content: [{ type: "text", text: `## Listeners\n${listeners}\n\n## Health checks\n${healthLines.join("\n")}` }] };
    });


  // ── Knowledge Base tools ──

  loggedTool("kb_search", "Search the knowledge base (vector + full-text hybrid). Use for: finding prior work, context about projects, past decisions.",
    {
      query: z.string().describe("Natural language search query"),
      n: z.number().optional().describe("Number of results (default 8)"),
      type: z.string().optional().describe("Filter by doc_type: context, memory, chat, note"),
    },
    async ({ query, n = 8, type }) => {
      const typeArg = type ? `--type ${type}` : "";
      const out = runCmd(
        `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py search ${JSON.stringify(query)} --n ${n} ${typeArg}`,
        "/", 20000
      );
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("kb_add", "Add content to the knowledge base. Use at end of sessions to save key findings, decisions, or learned context.",
    {
      content: z.string().describe("Content to store"),
      source: z.string().describe("Identifier for the source (e.g. 'session-2026-04-13', 'project-x-decision')"),
      doc_type: z.string().optional().describe("Type: note (default), context, memory, chat"),
      tags: z.string().optional().describe("Comma-separated tags"),
    },
    async ({ content, source, doc_type = "note", tags = "" }) => {
      const { writeFileSync, unlinkSync } = await import("fs");
      const tmp = `/tmp/kb_add_${Date.now()}.txt`;
      writeFileSync(tmp, content, "utf-8");
      const out = runCmd(
        `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py add --file ${tmp} --source ${JSON.stringify(source)} --type ${doc_type} --tags ${JSON.stringify(tags)}`,
        "/", 20000
      );
      try { unlinkSync(tmp); } catch {}
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("kb_load_context", "Load relevant context from KB + Mem0 memories for a task. Call at the START of long sessions or complex tasks to prime your working context.",
    {
      task: z.string().describe("Description of the task or topic to load context for"),
      n: z.number().optional().describe("Number of KB results (default 10)"),
    },
    async ({ task, n = 10 }) => {
      const out = runCmd(
        `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py context ${JSON.stringify(task)} --n ${n}`,
        "/", 25000
      );
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("kb_graph", "Add or query entity relationships in the knowledge graph.",
    {
      action: z.enum(["link", "query"]).describe("'link' adds a relation, 'query' finds all relations for an entity"),
      entity: z.string().describe("Primary entity name"),
      relation: z.string().optional().describe("Relation type (required for link, e.g. 'uses', 'is-part-of', 'depends-on')"),
      target: z.string().optional().describe("Target entity (required for link)"),
      source: z.string().optional().describe("Source label for link"),
    },
    async ({ action, entity, relation = "", target = "", source = "" }) => {
      let cmd;
      if (action === "link") {
        cmd = `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py graph-link ${JSON.stringify(entity)} ${JSON.stringify(relation)} ${JSON.stringify(target)} --source ${JSON.stringify(source)}`;
      } else {
        cmd = `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py graph-query ${JSON.stringify(entity)}`;
      }
      const out = runCmd(cmd, "/", 15000);
      return { content: [{ type: "text", text: out }] };
    });


  loggedTool("kb_ingest_url", "Fetch a URL and ingest its text content into the knowledge base. Useful for adding docs, GitHub READMEs, reference pages.",
    {
      url: z.string().describe("URL to fetch and ingest"),
      source: z.string().describe("Label for this content in the KB (e.g. 'mds-datasheet', 'mpc850-ref')"),
      doc_type: z.string().optional().describe("Type tag: context, memory, note, chat. Default: context"),
      tags: z.string().optional().describe("Comma-separated tags"),
    },
    async ({ url, source, doc_type = "context", tags = "" }) => {
      const escaped = url.replace(/'/g, "'\\''");
      const text = runCmd(`curl -sL --max-time 20 '${escaped}' | python3 -c "
import sys, re
html = sys.stdin.read()
# Strip tags, collapse whitespace
text = re.sub(r'<[^>]+>', ' ', html)
text = re.sub(r'[ \\t]+', ' ', text)
text = re.sub(r'\\n{3,}', '\\n\\n', text)
print(text[:50000].strip())
"`, "/", 25000).trim();
      if (!text || text.startsWith("ERROR")) {
        return { content: [{ type: "text", text: `Failed to fetch: ${url}\n${text}` }] };
      }
      const { writeFileSync, unlinkSync } = await import("fs");
      const tmp = `/tmp/kb_url_${Date.now()}.txt`;
      writeFileSync(tmp, text, "utf-8");
      const out = runCmd(
        `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py add --file ${tmp} --source ${JSON.stringify(source)} --type ${doc_type} --tags ${JSON.stringify(tags)}`,
        "/", 30000
      );
      try { unlinkSync(tmp); } catch {}
      return { content: [{ type: "text", text: `Fetched ${text.length} chars from ${url}\n${out}` }] };
    });


  loggedTool("kb_sync_check", "Check (and optionally repair) sync between Qdrant vectors and PostgreSQL FTS. Pass execute=true to auto-repair orphans.",
    { execute: z.boolean().optional().describe("If true, delete orphaned records. Default: dry-run.") },
    async ({ execute = false }) => {
      const flag = execute ? "--execute" : "";
      const out = runCmd(
        `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py sync-check ${flag}`,
        "/", 20000
      );
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("kb_vacuum", "Find and optionally remove stale duplicate chunks (same source ingested multiple times). Pass execute=true to delete old generations.",
    { execute: z.boolean().optional().describe("If true, remove old generations. Default: dry-run.") },
    async ({ execute = false }) => {
      const flag = execute ? "--execute" : "";
      const out = runCmd(
        `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py vacuum ${flag}`,
        "/", 20000
      );
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("kb_export", "Export knowledge base to JSONL. Returns server-side file path and row count. Optionally filter by doc_type or source substring.",
    {
      doc_type: z.string().optional().describe("Filter by doc_type (e.g. 'context', 'chat', 'note')"),
      source:   z.string().optional().describe("Filter by source substring (case-insensitive)"),
    },
    async ({ doc_type, source }) => {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const outPath = `/tmp/kb_export_${ts}.jsonl`;
      const typeFlag   = doc_type ? `--type "${doc_type}"`   : "";
      const sourceFlag = source   ? `--source "${source}"` : "";
      const cmd = `cd /opt/organizer/scripts/kb-scripts && /root/.local/bin/uv run --env-file .env python3 kb.py export ${typeFlag} ${sourceFlag} > ${outPath}`;
      runCmd(cmd, "/", 60000);
      const lines = runCmd(`wc -l < ${outPath} 2>/dev/null || echo 0`, "/").trim();
      return { content: [{ type: "text", text: `Export saved to ${outPath}\n${lines} rows exported.` }] };
    });

  // ── System / infra tools ──

  loggedTool("sysinfo", "Get CPU, RAM, disk, and load stats for the server.",
    {},
    async () => {
      const cpu = runCmd("top -bn1 | grep 'Cpu(s)'", "/").trim();
      const mem = runCmd("free -h", "/").trim();
      const disk = runCmd("df -h / /opt", "/").trim();
      const load = runCmd("uptime", "/").trim();
      const top5 = runCmd("ps aux --sort=-%cpu | head -6", "/").trim();
      return { content: [{ type: "text", text: `## Load\n${load}\n\n## CPU\n${cpu}\n\n## Memory\n${mem}\n\n## Disk\n${disk}\n\n## Top Processes\n${top5}` }] };
    });

  loggedTool("docker_status", "List Docker containers with status and resource usage.",
    {},
    async () => {
      const ps = runCmd("docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}'", "/").trim();
      const stats = runCmd("docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}'", "/").trim();
      return { content: [{ type: "text", text: `## Containers\n${ps}\n\n## Stats\n${stats}` }] };
    });

  loggedTool("service_control", "Start, stop, restart, or get status of an allowed systemd service.",
    {
      service: z.string().describe("Service name e.g. organizer, nginx"),
      action: z.enum(["status", "start", "stop", "restart"]),
    },
    async ({ service, action }) => {
      const SAFE_SERVICES = ["organizer", "organizer-mcp", "organizer-commit", "nginx", "mem0", "docker", "fail2ban", "ssh"];
      if (!SAFE_SERVICES.includes(service)) {
        return { content: [{ type: "text", text: `Error: '${service}' not in allowlist. Allowed: ${SAFE_SERVICES.join(", ")}` }] };
      }
      const out = runCmd(`systemctl ${action} ${service} 2>&1 && systemctl status ${service} --no-pager -l 2>&1 | head -30`, "/").trim();
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("db_query", "Run a read-only SELECT query against the organizer SQLite database.",
    {
      sql: z.string().describe("SELECT statement only"),
    },
    async ({ sql }) => {
      if (!sql.trim().toLowerCase().startsWith("select")) {
        return { content: [{ type: "text", text: "Error: only SELECT queries are allowed." }] };
      }
      const escaped = sql.replace(/'/g, "'\\''");
      const out = runCmd(`sqlite3 -column -header /opt/organizer/data/organizer.db '${escaped}' 2>&1 | head -100`, "/").trim();
      return { content: [{ type: "text", text: out || "(no rows)" }] };
    });

  loggedTool("fail2ban_status", "Show fail2ban jail stats and recently banned IPs.",
    {},
    async () => {
      const status = runCmd("fail2ban-client status 2>&1", "/").trim();
      const sshd = runCmd("fail2ban-client status sshd 2>&1", "/").trim();
      const nginx = runCmd("fail2ban-client status nginx-limit-req 2>&1 || true", "/").trim();
      return { content: [{ type: "text", text: `## Jails\n${status}\n\n## sshd\n${sshd}\n\n## nginx\n${nginx}` }] };
    });

  loggedTool("fetch", "Make an HTTP request and return the response (text/JSON). Useful for local APIs or external endpoints.",
    {
      url: z.string(),
      method: z.string().optional().describe("HTTP method. Default: GET"),
      body: z.string().optional().describe("Request body for POST/PUT"),
      headers: z.string().optional().describe("Extra headers as 'Key: Value' lines"),
    },
    async ({ url, method = "GET", body, headers }) => {
      let cmd = `curl -s -L -X ${method} --max-time 15`;
      if (headers) {
        for (const line of headers.split("\n")) {
          const h = line.trim();
          if (h) cmd += ` -H '${h.replace(/'/g, "'\\''")}'`;
        }
      }
      if (body) cmd += ` -d '${body.replace(/'/g, "'\\''")}'`;
      cmd += ` '${url.replace(/'/g, "'\\''")}'`;
      const out = runCmd(cmd, "/").slice(0, 4000);
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("browser_get", "Fetch a web page with headless Chromium and return the text content.",
    { url: z.string() },
    async ({ url }) => {
      const out = runCmd(`python3 /opt/organizer/scripts/browser.py get '${url.replace(/'/g, "'\\''")}'`, "/", 30000).slice(0, 8000);
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("browser_screenshot", "Take a screenshot of a URL with headless Chromium. Returns base64 PNG.",
    { url: z.string() },
    async ({ url }) => {
      const out = runCmd(`python3 /opt/organizer/scripts/browser.py screenshot '${url.replace(/'/g, "'\\''")}'`, "/", 30000).trim();
      if (out.startsWith("data:image")) {
        return { content: [{ type: "image", data: out.replace("data:image/png;base64,", ""), mimeType: "image/png" }] };
      }
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("pdf_read", "Extract text from a PDF file on the server using pdftotext.",
    { path: z.string().describe("Absolute path to the PDF") },
    async ({ path: filePath }) => {
      const { resolve } = await import("path");
      const abs = resolve(filePath);
      const out = runCmd(`pdftotext '${abs.replace(/'/g, "'\\''")}'  - 2>&1 | head -200`, "/").trim();
      return { content: [{ type: "text", text: out }] };
    });

  loggedTool("image_info", "Inspect or thumbnail an image using ImageMagick. Actions: info, thumbnail (256x256).",
    {
      path: z.string().describe("Absolute path to the image"),
      action: z.enum(["info", "thumbnail"]).optional().describe("Default: info"),
    },
    async ({ path: filePath, action = "info" }) => {
      const { resolve } = await import("path");
      const { readFileSync } = await import("fs");
      const abs = resolve(filePath);
      const escaped = abs.replace(/'/g, "'\\''");
      if (action === "thumbnail") {
        const outPath = `/tmp/thumb_${Date.now()}.png`;
        runCmd(`convert '${escaped}' -resize 256x256^ -gravity center -extent 256x256 '${outPath}' 2>&1`, "/");
        const data = readFileSync(outPath).toString("base64");
        return { content: [{ type: "image", data, mimeType: "image/png" }] };
      }
      const out = runCmd(`identify -verbose '${escaped}' 2>&1 | head -50`, "/").trim();
      return { content: [{ type: "text", text: out }] };
    });

  // ── Image + changelog tools ──

  loggedTool("generate_image", "Generate an image with Nano Banana. Default: free tier. Pass 'nb2' or 'nbpro' only when user explicitly requests higher quality.",
    {
      prompt: z.string(),
      model: z.string().optional().describe("Omit for free default. 'nb2' (paid) or 'nbpro' (paid, highest) on explicit request only."),
    },
    async ({ prompt, model }) => {
      const resolvedModel = NB_MODELS[model || "free"] || NB_MODELS.free;
      const result = await generateImage(prompt, resolvedModel);
      return {
        content: [
          { type: "text", text: `Image saved: ${result.path}\nModel: ${resolvedModel}${result.text ? `\nCaption: ${result.text}` : ""}` },
          { type: "image", data: result.base64, mimeType: result.mimeType || "image/png" },
        ]
      };
    });

  loggedTool("view_changelog", "Query the append-only changelog.",
    {
      tail: z.number().optional().describe("Last N entries (default 20)"),
      agent_id: z.string().optional().describe("Filter: claude, gemini, system, cron"),
      action_type: z.string().optional().describe("Filter: tool_call, subagent, deploy, git, maintenance"),
      since: z.string().optional().describe("ISO datetime"),
      search: z.string().optional().describe("Substring search"),
    },
    async ({ tail, agent_id, action_type, since, search }) => {
      const entries = readChangelog({ tail: tail || 20, agent_id, action_type, since, search });
      if (entries.length === 0) return { content: [{ type: "text", text: "No changelog entries found." }] };
      const formatted = entries.map(e => `[${e.timestamp}] ${e.agent_id} | ${e.action_type} | ${e.outcome} | ${JSON.stringify(e.action_detail).slice(0, 150)}`).join("\n");
      return { content: [{ type: "text", text: `${entries.length} entries:\n${formatted}` }] };
    });

  loggedTool("verify_changelog", "Verify hash-chain integrity of the changelog.", {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(verifyChain(), null, 2) }] }));


  // ── A2A Client Tools (Claude → Gemini A2A) ───────────────────

  loggedTool("a2a_send", "Send a task to the Gemini A2A agent. Returns completed task with response artifact.",
    {
      message: z.string().describe("The message/prompt to send to Gemini"),
      task_id: z.string().optional().describe("Optional task ID (auto-generated if omitted)"),
      skill: z.string().optional().describe("Skill hint: general | code | task_analysis | ics_ot"),
      model: z.string().optional().describe("Gemini model override"),
    },
    async ({ message, task_id, skill, model }) => {
      const tid = task_id || randomUUID();
      const body = {
        jsonrpc: "2.0", id: `mcp-${Date.now()}`, method: "tasks/send",
        params: {
          id: tid,
          message: { role: "user", parts: [{ type: "text", text: message }] },
          metadata: { skill: skill || "general", ...(model ? { model } : {}) },
        },
      };
      const resp = await fetch(`http://127.0.0.1:${PORT}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-a2a-token": AUTH_TOKEN },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.error) return { content: [{ type: "text", text: `A2A error: ${JSON.stringify(data.error)}` }] };
      const task = data.result;
      const artifact = task.artifacts?.[0]?.parts?.[0]?.text || "(no response)";
      const meta = task.artifacts?.[0]?.metadata || {};
      return { content: [{ type: "text", text: `[A2A task: ${task.id} | ${task.status.state}${meta.model ? ` | ${meta.model}` : ""}${meta.tokens ? ` | ${meta.tokens}t` : ""}]\n\n${artifact}` }] };
    });

  loggedTool("a2a_get", "Get a previously submitted A2A task by ID.",
    { task_id: z.string() },
    async ({ task_id }) => {
      const body = { jsonrpc: "2.0", id: `mcp-${Date.now()}`, method: "tasks/get", params: { id: task_id } };
      const resp = await fetch(`http://127.0.0.1:${PORT}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-a2a-token": AUTH_TOKEN },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.error) return { content: [{ type: "text", text: `A2A error: ${JSON.stringify(data.error)}` }] };
      const task = data.result;
      const artifact = task.artifacts?.[0]?.parts?.[0]?.text || "(no artifact yet)";
      return { content: [{ type: "text", text: `Task ${task.id}: ${task.status.state}\n\n${artifact}` }] };
    });

  loggedTool("a2a_list", "List recent A2A tasks sent to Gemini.",
    { limit: z.number().optional().describe("Max tasks to return (default 10)") },
    async ({ limit }) => {
      const body = { jsonrpc: "2.0", id: `mcp-${Date.now()}`, method: "tasks/list", params: { limit: limit || 10 } };
      const resp = await fetch(`http://127.0.0.1:${PORT}/a2a`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-a2a-token": AUTH_TOKEN },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.error) return { content: [{ type: "text", text: `A2A error: ${JSON.stringify(data.error)}` }] };
      const tasks = data.result.tasks;
      if (!tasks.length) return { content: [{ type: "text", text: "No A2A tasks found." }] };
      const lines = tasks.map(t => `${t.id.slice(0,8)}… | ${t.status.state} | ${t.status.timestamp} | ${(t.artifacts?.[0]?.parts?.[0]?.text || "").slice(0,80)}…`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    });

  return server;
}

// ── A2A Task Store ────────────────────────────────────────────
const a2aTasks = new Map(); // taskId → task object
const A2A_MAX_TASKS = 200;

function a2aCreateTask(id, message) {
  const task = {
    id,
    status: { state: "submitted", timestamp: new Date().toISOString() },
    history: [{ role: "user", parts: message.parts, timestamp: new Date().toISOString() }],
    artifacts: [],
    metadata: {},
  };
  a2aTasks.set(id, task);
  // Evict oldest if over limit
  if (a2aTasks.size > A2A_MAX_TASKS) {
    const oldest = a2aTasks.keys().next().value;
    a2aTasks.delete(oldest);
  }
  return task;
}

function a2aTaskToResponse(task) {
  return { id: task.id, status: task.status, artifacts: task.artifacts, history: task.history };
}

// ── A2A Routes ────────────────────────────────────────────────

// Agent Card
app.get("/.well-known/agent.json", (req, res) => {
  res.json({
    name: "Gemini on 7ay.de",
    description: "Gemini-2.5-flash agent — general reasoning, code, task analysis, ICS/OT research support.",
    url: "https://7ay.de/a2a",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      { id: "general",       name: "General reasoning",  description: "Open-ended questions, analysis, summaries" },
      { id: "code",          name: "Code & engineering", description: "Generate, review, debug code" },
      { id: "task_analysis", name: "Task board analysis", description: "Reason about Anas's active task board with live DB context" },
      { id: "ics_ot",        name: "ICS/OT research",    description: "Protocol analysis, firmware RE, testbed reasoning" },
    ],
  });
});

// JSON-RPC 2.0 A2A endpoint
app.post("/a2a", express.json(), async (req, res) => {
  if (AUTH_TOKEN && req.headers["x-a2a-token"] !== AUTH_TOKEN) {
    return res.status(401).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "unauthorized" } });
  }

  const { jsonrpc, id: rpcId, method, params } = req.body || {};
  if (jsonrpc !== "2.0") return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC" } });

  // ── tasks/send ──
  if (method === "tasks/send") {
    const { id: taskId, message, metadata = {} } = params || {};
    if (!taskId || !message) return res.json({ jsonrpc: "2.0", id: rpcId, error: { code: -32602, message: "id and message required" } });

    const task = a2aCreateTask(taskId, message);
    task.metadata = metadata;
    task.status = { state: "working", timestamp: new Date().toISOString() };

    logEvent({ agent_id: "gemini", action_type: "tool_call", action_detail: { a2a: "tasks/send", task_id: taskId, skill: metadata.skill }, outcome: "started" });

    try {
      const textParts = message.parts.filter(p => p.type === "text" || typeof p.text === "string").map(p => p.text).join("\n");
      const model = metadata.model || undefined;
      const result = await geminiInvoke(textParts, { timeout: 120000, model });

      task.status = { state: "completed", timestamp: new Date().toISOString() };
      task.artifacts = [{ name: "response", parts: [{ type: "text", text: result.response }], metadata: { model: result.model, tokens: result.tokens } }];
      task.history.push({ role: "agent", parts: [{ type: "text", text: result.response }], timestamp: new Date().toISOString() });

      logEvent({ agent_id: "gemini", action_type: "tool_call", action_detail: { a2a: "tasks/send", task_id: taskId, model: result.model, tokens: result.tokens }, outcome: "success" });
      return res.json({ jsonrpc: "2.0", id: rpcId, result: a2aTaskToResponse(task) });
    } catch (err) {
      task.status = { state: "failed", timestamp: new Date().toISOString(), message: err.message };
      logEvent({ agent_id: "gemini", action_type: "tool_call", action_detail: { a2a: "tasks/send", task_id: taskId, error: err.message }, outcome: "error" });
      return res.json({ jsonrpc: "2.0", id: rpcId, result: a2aTaskToResponse(task) });
    }
  }

  // ── tasks/get ──
  if (method === "tasks/get") {
    const { id: taskId } = params || {};
    const task = a2aTasks.get(taskId);
    if (!task) return res.json({ jsonrpc: "2.0", id: rpcId, error: { code: -32001, message: `Task not found: ${taskId}` } });
    return res.json({ jsonrpc: "2.0", id: rpcId, result: a2aTaskToResponse(task) });
  }

  // ── tasks/cancel ──
  if (method === "tasks/cancel") {
    const { id: taskId } = params || {};
    const task = a2aTasks.get(taskId);
    if (!task) return res.json({ jsonrpc: "2.0", id: rpcId, error: { code: -32001, message: `Task not found: ${taskId}` } });
    if (task.status.state === "working") {
      task.status = { state: "canceled", timestamp: new Date().toISOString() };
    }
    return res.json({ jsonrpc: "2.0", id: rpcId, result: a2aTaskToResponse(task) });
  }

  // ── tasks/list (extension) ──
  if (method === "tasks/list") {
    const { limit = 20 } = params || {};
    const all = [...a2aTasks.values()].slice(-limit).reverse();
    return res.json({ jsonrpc: "2.0", id: rpcId, result: { tasks: all.map(a2aTaskToResponse) } });
  }

  return res.json({ jsonrpc: "2.0", id: rpcId, error: { code: -32601, message: `Method not found: ${method}` } });
});


app.listen(PORT, "127.0.0.1", () => {
  logEvent({ agent_id: "system", action_type: "lifecycle", action_detail: { event: "mcp_server_started", port: PORT, version: "2.2.0" }, outcome: "success" });
  console.log(`MCP server v2.2.0 on 127.0.0.1:${PORT}`);
});
