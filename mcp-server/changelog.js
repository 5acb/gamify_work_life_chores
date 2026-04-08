// ── Append-only hash-chained JSONL changelog ──────────────────
// Inspired by IETF draft-sharif-agent-audit-trail-00
// Every significant action (MCP tool call, subagent run, deploy, git op, API mutation)
// writes here. Each entry includes SHA-256 of the previous entry for tamper evidence.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { dirname } from "path";

const CHANGELOG_PATH = process.env.CHANGELOG_PATH || "/opt/organizer/data/changelog.jsonl";

// Cache the last hash in memory for fast chaining
let _lastHash = null;

function getLastHash() {
  if (_lastHash) return _lastHash;
  if (!existsSync(CHANGELOG_PATH)) return "genesis";
  try {
    const lines = readFileSync(CHANGELOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) return "genesis";
    const last = JSON.parse(lines[lines.length - 1]);
    const hash = createHash("sha256").update(JSON.stringify(last)).digest("hex");
    _lastHash = hash;
    return hash;
  } catch {
    return "genesis";
  }
}

/**
 * Log an event to the changelog.
 * @param {object} opts
 * @param {string} opts.agent_id - "claude", "gemini", "gemini:code_review", "cron", "user", "system"
 * @param {string} opts.session_id - chat/session identifier (optional)
 * @param {string} opts.action_type - "tool_call", "subagent", "deploy", "git", "api_mutation", "maintenance", "lifecycle"
 * @param {object} opts.action_detail - { tool, args, result_summary } or similar
 * @param {string} opts.outcome - "success", "error", "partial"
 * @param {string} [opts.parent_id] - for subagent chains, the parent event id
 */
export function logEvent({ agent_id, session_id, action_type, action_detail, outcome, parent_id }) {
  mkdirSync(dirname(CHANGELOG_PATH), { recursive: true });
  const prev_hash = getLastHash();
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent_id: agent_id || "unknown",
    session_id: session_id || null,
    action_type,
    action_detail,
    outcome: outcome || "success",
    parent_id: parent_id || null,
    prev_hash,
  };
  const line = JSON.stringify(entry);
  appendFileSync(CHANGELOG_PATH, line + "\n");
  _lastHash = createHash("sha256").update(line).digest("hex");
  return entry;
}

/**
 * Read changelog entries with optional filters.
 * @param {object} [opts]
 * @param {number} [opts.tail] - last N entries
 * @param {string} [opts.agent_id] - filter by agent
 * @param {string} [opts.action_type] - filter by action type
 * @param {string} [opts.since] - ISO datetime, entries after this
 * @param {string} [opts.search] - substring search in action_detail
 */
export function readChangelog({ tail, agent_id, action_type, since, search } = {}) {
  if (!existsSync(CHANGELOG_PATH)) return [];
  let lines = readFileSync(CHANGELOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  let entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  if (since) {
    const cutoff = new Date(since).getTime();
    entries = entries.filter(e => new Date(e.timestamp).getTime() >= cutoff);
  }
  if (agent_id) entries = entries.filter(e => e.agent_id === agent_id || e.agent_id?.startsWith(agent_id + ":"));
  if (action_type) entries = entries.filter(e => e.action_type === action_type);
  if (search) {
    const s = search.toLowerCase();
    entries = entries.filter(e => JSON.stringify(e.action_detail).toLowerCase().includes(s));
  }
  if (tail) entries = entries.slice(-tail);
  return entries;
}

/**
 * Verify hash chain integrity.
 * @returns {{ valid: boolean, entries: number, broken_at?: number }}
 */
export function verifyChain() {
  if (!existsSync(CHANGELOG_PATH)) return { valid: true, entries: 0 };
  const lines = readFileSync(CHANGELOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  let prevHash = "genesis";
  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.prev_hash !== prevHash) return { valid: false, entries: lines.length, broken_at: i };
      prevHash = createHash("sha256").update(lines[i]).digest("hex");
    } catch {
      return { valid: false, entries: lines.length, broken_at: i };
    }
  }
  return { valid: true, entries: lines.length };
}
