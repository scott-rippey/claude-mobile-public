#!/bin/bash
# Double-click to start cc-server locally (no Cloudflare tunnel)

cd "$(dirname "$0")/cc-server" || exit 1

# Kill anything already on port 3020
EXISTING=$(lsof -ti :3020)
if [ -n "$EXISTING" ]; then
  echo "Port 3020 in use (PID $EXISTING) — killing..."
  echo "$EXISTING" | xargs kill -9 2>/dev/null
  sleep 1
fi

echo "Starting CC Server (local only, no tunnel)..."
npx tsx src/server.ts
