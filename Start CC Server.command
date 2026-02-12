#!/bin/bash
# Double-click this file to start the Cloudflare tunnel and CC server

cd "$(dirname "$0")" || exit 1

# Tunnel token
TUNNEL_TOKEN="eyJhIjoiZWE4NjA0NWZjY2ViYjVhNGRmOTMyOWExNzllMTI0MTUiLCJ0IjoiYWNlYWY2YmYtYmZlOS00NTA3LWIyZWYtMmRjMjg5NjY5NjM5IiwicyI6Ill6bGpNR1JsTWpBdFlXUTFNUzAwTmpaakxUbGxaREF0WVRKak1UVTBZMll3T0dNeCJ9"

echo "Starting Cloudflare tunnel..."
cloudflared tunnel run --token "$TUNNEL_TOKEN" &
TUNNEL_PID=$!

# Give tunnel a moment to connect
sleep 2

echo "Starting CC Server..."
cd cc-server || exit 1
npx tsx src/server.ts

# When server exits, kill the tunnel
echo "Shutting down tunnel..."
kill $TUNNEL_PID 2>/dev/null
