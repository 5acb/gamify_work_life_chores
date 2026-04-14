#!/usr/bin/env bash
# post-session-kb.sh — Save session insights to the KB on 7ay.de
# Triggered by the Claude Code Stop hook.
# Reads JSON from stdin: {"session_id": "...", "transcript_path": "...", "cwd": "..."}

set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || true)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id','unknown')[:12])" 2>/dev/null || true)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || true)
DATE=$(date +%Y-%m-%d)

[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

# Extract meaningful assistant messages (skip credential-looking content)
CONTENT=$(python3 << PYEOF
import json, re, sys

CRED = re.compile(
    r'(AAAA[A-Za-z0-9+/]{20,}|(?:api|auth|secret|token)[_\s]*[=:]\s*\S{20,})',
    re.IGNORECASE
)

chunks = []
with open("$TRANSCRIPT", encoding="utf-8", errors="ignore") as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            msg = json.loads(line)
        except:
            continue
        if msg.get("type") not in ("user", "assistant"):
            continue
        inner = msg.get("message", {})
        role = inner.get("role", msg.get("type", ""))
        content = inner.get("content", "")
        if isinstance(content, list):
            content = " ".join(c.get("text","") for c in content if isinstance(c,dict) and c.get("type")=="text")
        if role == "assistant" and len(content) > 200:
            if CRED.search(content):
                continue
            chunks.append(content[:1200])

# Take last 15 meaningful assistant messages (most recent context)
recent = chunks[-15:]
print("\n\n---\n\n".join(recent))
PYEOF
)

[[ -z "$CONTENT" ]] && exit 0

# Determine source label from cwd
PROJECT=$(basename "$CWD" 2>/dev/null || echo "unknown")
SOURCE="session-${DATE}-${PROJECT}-${SESSION_ID}"

# SSH to server and add to KB
TMP=$(mktemp)
echo "$CONTENT" > "$TMP"
scp -q "$TMP" "root@7ay.de:/tmp/kb_hook_${SESSION_ID}.txt" 2>/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 root@7ay.de \
  "export PATH=\$PATH:\$HOME/.local/bin && cd /opt/organizer/scripts/kb-scripts && uv run --env-file .env python3 kb.py add --file /tmp/kb_hook_${SESSION_ID}.txt --source '${SOURCE}' --type chat 2>/dev/null && rm -f /tmp/kb_hook_${SESSION_ID}.txt" \
  2>/dev/null || true

rm -f "$TMP"
