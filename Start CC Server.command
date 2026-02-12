#!/bin/bash
# Double-click this file to start the CC Interface server
cd "$(dirname "$0")/cc-server" || exit 1
echo "Starting CC Server..."
npx tsx src/server.ts
