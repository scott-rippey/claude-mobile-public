#!/bin/bash
# Double-click this file to start the Cloudflare tunnel and CC server
# cc-server auto-restarts if it crashes

cd "$(dirname "$0")" || exit 1

# Tunnel token
TUNNEL_TOKEN="eyJhIjoiZWE4NjA0NWZjY2ViYjVhNGRmOTMyOWExNzllMTI0MTUiLCJ0IjoiYWNlYWY2YmYtYmZlOS00NTA3LWIyZWYtMmRjMjg5NjY5NjM5IiwicyI6Ill6bGpNR1JsTWpBdFlXUTFNUzAwTmpaakxUbGxaREF0WVRKak1UVTBZMll3T0dNeCJ9"

cleanup() {
  echo "Shutting down..."
  kill $TUNNEL_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting Cloudflare tunnel..."
cloudflared tunnel run --token "$TUNNEL_TOKEN" &
TUNNEL_PID=$!

# Give tunnel a moment to connect
sleep 2

echo "Starting CC Server (auto-restart enabled)..."
cd cc-server || exit 1

while true; do
  npx tsx src/server.ts
  EXIT_CODE=$?
  echo ""
  echo "CC Server exited with code $EXIT_CODE"
  echo "Restarting in 3 seconds... (Ctrl+C to stop)"
  sleep 3
done
