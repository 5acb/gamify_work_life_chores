#!/bin/bash
# Spin up test instance for headless render tests
set -e

TEST_PORT=3010
ENV_FILE=/opt/organizer/data/test.env
LOG=/tmp/test-instance.log

echo "[test] Killing existing test instance on :$TEST_PORT"
kill $(lsof -ti:$TEST_PORT) 2>/dev/null || true
sleep 1

echo "[test] Starting test instance (env from $ENV_FILE)"
set -a && source "$ENV_FILE" && set +a
node /opt/organizer/repo/server.js >> $LOG 2>&1 &
TEST_PID=$!
echo "[test] PID=$TEST_PID"
sleep 3

echo "[test] Getting potato session"
COOKIE=$(curl -si http://localhost:$TEST_PORT/api/dev/potato | grep Set-Cookie | sed 's/.*sid=\([^;]*\).*/sid=\1/')
echo "[test] Cookie: $COOKIE"

echo "[test] Checking task API"
curl -s "http://localhost:$TEST_PORT/api/users/potato/tasks" -b "$COOKIE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tasks=d.get('tasks',[])
print(f'[test] {len(tasks)} tasks: {[t[\"name\"] for t in tasks]}')
"

echo "[test] Done — instance on :$TEST_PORT. To stop: kill $TEST_PID"
