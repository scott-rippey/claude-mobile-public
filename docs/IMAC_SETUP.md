# iMac Setup Guide

Run these from Claude Code on the iMac. Open CC in the project folder:
`~/App Development/Personal/CC Interface`

## One-time setup (do these once)

### 1. Install cloudflared

```bash
brew install cloudflared
```

### 2. Install the tunnel as a service (starts on boot)

```bash
sudo cloudflared service install eyJhIjoiZWE4NjA0NWZjY2ViYjVhNGRmOTMyOWExNzllMTI0MTUiLCJ0IjoiYWNlYWY2YmYtYmZlOS00NTA3LWIyZWYtMmRjMjg5NjY5NjM5IiwicyI6Ill6bGpNR1JsTWpBdFlXUTFNUzAwTmpaakxUbGxaREF0WVRKak1UVTBZMll3T0dNeCJ9
```

### 3. Verify BASE_DIR in cc-server/.env

The `.env` syncs via Syncthing. If your iMac username is different, update `BASE_DIR` to match:

```bash
whoami
```

If that prints `scottrippey`, you're good. If it prints something else, update `cc-server/.env` — change `BASE_DIR=/Users/WHATEVER_IT_SAID/App Development`.

### 4. Install cc-server dependencies (just in case)

```bash
cd cc-server && npm install
```

## Test it

### Start the server

```bash
cd cc-server && npm run dev
```

### Check tunnel is working

From your phone browser: `https://api.claudemobile.dev/health`

Should return: `{"status":"ok","timestamp":"..."}`

### Check the full app

From your phone: `https://claudemobile-sigma.vercel.app`

## Daily use

The tunnel auto-starts on boot. Just start cc-server:

Double-click **Start CC Server.command** in Finder, or from terminal:

```bash
cd ~/App\ Development/Personal/CC\ Interface/cc-server && npm run dev
```
