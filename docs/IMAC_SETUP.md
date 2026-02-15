# Server Machine Setup

The server machine runs cc-server (Express + Claude Agent SDK) and the Cloudflare tunnel. This can be any always-on machine — a Mac Mini, iMac, Linux server, etc.

## Prerequisites

- Node.js 18+
- Claude Code installed (uses your Claude Max/Pro subscription)
- Cloudflare tunnel token (from your Cloudflare dashboard)

## One-Time Setup

### 1. Install cloudflared

**macOS:**
```bash
brew install cloudflared
```

**Linux:**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### 2. Install the tunnel as a service (auto-starts on boot)

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
```

Replace `YOUR_TUNNEL_TOKEN` with the token from your Cloudflare dashboard (see README for setup instructions).

### 3. Configure cc-server

```bash
cp cc-server/.env.example cc-server/.env
```

Edit `cc-server/.env` and fill in your values:
- `SHARED_SECRET` — must match the value in your Vercel env vars
- `BASE_DIR` — root directory for file browsing (e.g. `/Users/yourname/projects`)
- `PORT` — defaults to 3020
- `TUNNEL_TOKEN` — your Cloudflare tunnel token

### 4. Install dependencies

```bash
cd cc-server && npm install
```

## Test It

### Start the server

```bash
cd cc-server && npm run dev
```

Or double-click `Start CC Server.command` (macOS) which starts both the tunnel and server with auto-restart.

### Verify the tunnel

From any browser: `https://your-tunnel-domain/health`

Should return: `{"status":"ok","timestamp":"..."}`

### Verify the full app

Open your Vercel app URL from your phone and sign in.

## Daily Use

If you installed cloudflared as a service, the tunnel auto-starts on boot. Just start cc-server:

Double-click **Start CC Server.command** in Finder, or from terminal:

```bash
cd /path/to/project/cc-server && npm run dev
```
