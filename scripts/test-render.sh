#!/bin/bash
# Spin up test instance, take screenshot, tear down
set -e

TEST_PORT=3010
TEST_DB=/opt/organizer/data/test.db
LOG=/tmp/test-instance.log

echo "[test] Killing existing test instance on :$TEST_PORT"
kill $(lsof -ti:$TEST_PORT) 2>/dev/null || true
sleep 1

echo "[test] Starting test instance"
GEMINI_API_KEY=$(grep GEMINI_API_KEY /etc/systemd/system/organizer.service | cut -d= -f3-) \
  PORT=$TEST_PORT DB_PATH=$TEST_DB NODE_ENV=development \
  node /opt/organizer/repo/server.js >> $LOG 2>&1 &
TEST_PID=$!
echo "[test] PID=$TEST_PID"
sleep 3

echo "[test] Getting potato session"
COOKIE=$(curl -si http://localhost:$TEST_PORT/api/dev/potato | grep Set-Cookie | sed 's/.*sid=\([^;]*\).*/sid=\1/')
echo "[test] Cookie: $COOKIE"

echo "[test] Checking task API"
curl -s http://localhost:$TEST_PORT/api/users/potato/tasks -b "$COOKIE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tasks=d.get('tasks',[])
print(f'[test] {len(tasks)} tasks: {[t[\"name\"] for t in tasks]}')
"

echo "[test] Done — instance running on :$TEST_PORT for manual screenshot"
echo "[test] To kill: kill $TEST_PID"
