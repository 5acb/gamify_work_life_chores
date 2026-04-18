#!/usr/bin/env bash
# setup-mcp-client.sh
# Wire the 7ay.de MCP into Gemini CLI on any machine, and install the Claude
# Code Stop hook for automatic session→KB export.
#
# NOTE: Claude (CLI + web) gets the 7ay MCP via account sync —
#       add it ONCE in claude.ai Settings → Integrations → MCP Servers,
#       then it propagates to every logged-in Claude CLI. NOT in mcp.json.
#
# Run once per machine. Safe to re-run (additive).
#   SSH_KEY=~/.ssh/id_ed25519 bash setup-mcp-client.sh   # optional, for Stop hook

set -euo pipefail

if [[ -z "${MCP_TOKEN:-}" ]]; then
  echo "[!] MCP_TOKEN environment variable is required."
  echo "    Get it from your sanctuary administrator."
  exit 1
fi
MCP_URL="https://7ay.de/mcp/sse?token=${MCP_TOKEN}"
HOOKS_DIR="$HOME/.claude/hooks"
HOOK_DEST="$HOOKS_DIR/post-session-kb.sh"
HOOK_SRC="$(cd "$(dirname "$0")" && pwd)/post-session-kb.sh"

echo "=== 7ay.de MCP client setup ==="
echo ""
echo "  [Claude] Add the MCP ONCE in your account:"
echo "           claude.ai → Settings → Integrations → MCP Servers"
echo "           URL: $MCP_URL"
echo "           (syncs to all Claude CLI instances automatically — no mcp.json needed)"
echo ""

# ── 1. Gemini CLI (~/.gemini/settings.json) ───────────────────────────────
GEMINI_JSON="$HOME/.gemini/settings.json"
mkdir -p "$HOME/.gemini"
[[ -f "$GEMINI_JSON" ]] || echo '{}' > "$GEMINI_JSON"
python3 - "$GEMINI_JSON" "$MCP_URL" << 'PY'
import json, sys
path, url = sys.argv[1], sys.argv[2]
with open(path) as f: d = json.load(f)
d.setdefault("mcpServers", {})["7ay"] = {"httpUrl": url}
with open(path, "w") as f: json.dump(d, f, indent=2)
PY
echo "[✓] Gemini CLI: $GEMINI_JSON"

# ── 2. Claude Stop hook (auto-save sessions to KB) ────────────────────────
if [[ ! -f "$HOOK_SRC" ]]; then
  echo "[!] post-session-kb.sh not found next to this script — hook skipped"
  echo "    Place it alongside setup-mcp-client.sh and re-run."
else
  mkdir -p "$HOOKS_DIR"
  cp "$HOOK_SRC" "$HOOK_DEST"
  chmod +x "$HOOK_DEST"

  CLAUDE_SETTINGS="$HOME/.claude/settings.json"
  [[ -f "$CLAUDE_SETTINGS" ]] || echo '{"permissions":{"allow":[]}}' > "$CLAUDE_SETTINGS"
  python3 - "$CLAUDE_SETTINGS" "$HOOK_DEST" << 'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
with open(path) as f: d = json.load(f)
stops = d.setdefault("hooks", {}).setdefault("Stop", [])
already = any(h.get("type")=="command" and h.get("command")==cmd
              for b in stops for h in b.get("hooks",[]))
if not already:
    stops.append({"hooks": [{"type": "command", "command": cmd, "async": True}]})
    with open(path, "w") as f: json.dump(d, f, indent=2)
print("  registered" if not already else "  already registered")
PY
  echo "[✓] Stop hook: $HOOK_DEST"
  if [[ -z "${SSH_KEY:-}" ]]; then
    echo ""
    echo "  Hook needs SSH to deploy@7ay.de. Add your pubkey there, then optionally:"
    echo "  SSH_KEY=~/.ssh/id_ed25519 bash setup-mcp-client.sh"
  fi
fi

echo ""
echo "=== Done. Restart Gemini CLI to pick up the MCP. ==="
