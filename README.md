# Claude Code Mobile

**v1.0.0**

Access Claude Code from your phone. Full Claude Agent SDK with file browsing, chat, terminal, and real-time streaming — all through a mobile-friendly web interface.

## Features

- **Chat with Claude Code** — full Agent SDK with token-by-token streaming, tool call indicators, and activity feedback
- **File Browser** — browse, view, and navigate your project files
- **Terminal** — execute commands on your server machine
- **Permission Modes** — Default, Accept Edits, and Plan mode switchable mid-conversation
- **Slash Commands** — built-in (`/help`, `/model`, `/status`, `/compact`) and custom `.md` commands
- **MCP Servers** — loads your configured MCP servers from project/user settings
- **Context Tracking** — live context usage bar with real-time token updates
- **Mobile-First** — designed for phone screens with touch-friendly controls

## Architecture

```
Phone (browser)
  → Vercel (Next.js + Google Auth)
    → API proxy routes
      → Cloudflare Tunnel
        → Your server machine (Express on port 3020)
          → Claude Agent SDK + file system access
```

**You need two things:**
1. **A server machine** (Mac, Linux, etc.) — runs cc-server and has access to your project files
2. **A Vercel deployment** — serves the frontend and authenticates users

## Prerequisites

- **Node.js 18+** on both your dev machine and server
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- **Google Cloud account** — for OAuth (free)
- **Cloudflare account** — for the tunnel (free tier works)
- **A domain name** — for the Cloudflare tunnel endpoint
- **Vercel account** — for frontend hosting (free tier works)

## Setup Guide

### 1. Clone and Install

```bash
git clone https://github.com/scott-rippey/claude-mobile-public.git
cd claude-mobile-public

# Install frontend dependencies
npm install

# Install server dependencies
cd cc-server && npm install && cd ..
```

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Navigate to **Google Auth Platform → Branding**
   - If you see "Google Auth platform not configured yet", click **Get Started**
   - Enter app name and your support email
   - Choose "External" user type
   - Add contact email and accept the User Data Policy
   - Click **Create**
4. Go to **Google Auth Platform → Audience**
   - Under **Test users**, click **Add users** and add your email
5. Go to **Google Auth Platform → Clients**
   - Click **Create Client**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://your-app.vercel.app/api/auth/callback/google`
6. Copy the **Client ID** and **Client Secret** immediately — the secret is only shown at creation time

### 3. Cloudflare Tunnel Setup

1. Log in to [Cloudflare One](https://one.dash.cloudflare.com) (Zero Trust dashboard)
2. Go to **Networks → Connectors → Cloudflare Tunnels**
3. Click **Create a tunnel** → choose **Cloudflared** as the connector type
4. Name it (e.g. "claude-mobile") and save
5. Copy the **tunnel token** — you'll need this for your server machine
6. In the **Published applications** tab, add a public hostname:
   - Subdomain: `api` (or your choice)
   - Domain: your domain
   - Service type: `HTTP`
   - URL: `localhost:3020`
7. Save

### 4. Server Machine Setup

On the machine that will run cc-server:

```bash
# Install cloudflared
brew install cloudflared  # macOS
# or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Configure cc-server
cp cc-server/.env.example cc-server/.env
```

Edit `cc-server/.env`:
```
SHARED_SECRET=generate-a-random-string-here
ANTHROPIC_API_KEY=sk-ant-...
BASE_DIR=/path/to/your/projects
PORT=3020
TUNNEL_TOKEN=eyJ...your-cloudflare-tunnel-token
```

Start the server:
```bash
# macOS: double-click Start CC Server.command
# or manually:
cd cc-server && npm run dev
```

The `Start CC Server.command` launcher starts both the Cloudflare tunnel and cc-server with auto-restart on crash.

### 5. Deploy to Vercel

1. Import the repo on [vercel.com/new](https://vercel.com/new)
2. Add these environment variables:

| Variable | Value |
|----------|-------|
| `TUNNEL_URL` | `https://api.yourdomain.com` (your Cloudflare tunnel hostname) |
| `SHARED_SECRET` | Same value as in cc-server/.env |
| `NEXTAUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` (your Vercel URL) |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `ALLOWED_EMAILS` | Comma-separated emails allowed to sign in |

3. Deploy

### 6. Test

1. Start cc-server on your server machine
2. Visit `https://your-tunnel-domain/health` — should return `{"status":"ok"}`
3. Visit your Vercel URL — sign in with Google
4. Browse files, open a project, start chatting

## Environment Variables Reference

### Vercel (frontend)

| Variable | Description |
|----------|-------------|
| `TUNNEL_URL` | Cloudflare Tunnel URL to your server machine |
| `SHARED_SECRET` | Auth token shared between Vercel and cc-server |
| `NEXTAUTH_SECRET` | NextAuth session encryption key |
| `NEXTAUTH_URL` | Your Vercel app URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated list of authorized Google emails |

### cc-server (server machine)

| Variable | Description |
|----------|-------------|
| `SHARED_SECRET` | Must match the Vercel value |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `BASE_DIR` | Root directory for file browsing and terminal |
| `PORT` | Server port (default: 3020) |
| `TUNNEL_TOKEN` | Cloudflare tunnel token |

## Usage

### Permission Modes

Switch modes using the selector above the chat input:

- **Default** — prompts for permission on dangerous operations (bash commands, etc.)
- **Accept Edits** — auto-allows file edits, still prompts for bash
- **Plan** — planning mode, no tool execution

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model [name]` | Show or change the model |
| `/status` | Session overview |
| `/context` | Context usage and loaded settings |
| `/mcp` | MCP server status |
| `/compact` | Compact conversation to free context |
| `/clear` | Clear conversation and start fresh |

Custom `.md` commands from `.claude/commands/` are also supported.

## Development

### Local Development

```bash
# Start Next.js dev server
npm run dev

# In another terminal, start cc-server
cd cc-server && npm run dev
```

### Pre-Commit Checks

```bash
npm run build        # Next.js production build
npx tsc --noEmit     # TypeScript check
npx eslint .         # Lint check
```

All three must pass before committing — every push triggers a Vercel deploy.

## Tech Stack

- **Frontend:** Next.js 15, Tailwind CSS, NextAuth
- **Backend:** Express, Claude Agent SDK, TypeScript (tsx)
- **Infrastructure:** Vercel, Cloudflare Tunnel
- **Auth:** Google OAuth via NextAuth

## License

MIT — see [LICENSE](LICENSE)
