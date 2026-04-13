import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
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

  return server;
}

app.listen(PORT, "127.0.0.1", () => {
  logEvent({ agent_id: "system", action_type: "lifecycle", action_detail: { event: "mcp_server_started", port: PORT, version: "2.2.0" }, outcome: "success" });
  console.log(`MCP server v2.2.0 on 127.0.0.1:${PORT}`);
});
