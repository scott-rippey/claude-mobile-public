# Code Anvil Mobile

**v1.2.0**

A mobile-friendly web interface for [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview). Access your local Claude Code CLI from your phone — full Agent SDK with file browsing, chat, terminal, and real-time streaming.

## Features

- **Chat with Claude Code** — full Agent SDK with token-by-token streaming, tool call indicators, and activity feedback (default model: `claude-opus-4-6`)
- **File Browser** — browse, view, and navigate your project files
- **Terminal** — execute commands on your server machine
- **Permission Modes** — Default, Accept Edits, Plan, and Bypass mode switchable mid-conversation (60s timeout with 45s warning)
- **Cost & Turn Limits** — set per-session budget caps ($1/$5/$25) and turn limits (5/10/25) via expandable settings panel
- **Mid-Query Controls** — switch models, adjust thinking budget, and manage MCP servers during active queries
- **Slash Commands** — built-in (`/help`, `/model`, `/status`, `/compact`, `/clear`) plus your existing custom `.md` commands
- **MCP Servers** — loads your configured MCP servers from project/user settings, plus [Context7](https://github.com/upstash/context7) for up-to-date library docs. Dynamic add/remove via API.
- **Context Tracking** — live context usage bar with real-time token updates and session cost display
- **Account Info** — shows authenticated user details, organization, and subscription type in `/status`
- **Mobile-First** — designed for phone screens with touch-friendly controls
- **Session Persistence** — sessions survive server restarts via debounced disk writes. Tracks model, cost, context usage per session. 24h TTL with auto-cleanup.
- **Graceful Interrupt** — first tap sends `response.interrupt()` (Claude finishes current thought), second tap within 3s forces a hard abort. Visual "Interrupting..." feedback.
- **Tool Hooks** — informational PreToolUse/PostToolUse hooks forward tool audit events to the client
- **Structured Output** — pass `outputFormat` with JSON schema for structured responses
- **Session Recovery** — `options.continue` auto-resumes most recent conversation when session is lost

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
1. **A server machine** (Mac, Linux, Windows with WSL) — runs cc-server and has access to your project files
2. **A Vercel deployment** — serves the frontend and authenticates users

## Prerequisites

- **Node.js 18+** on both your dev machine and server
- **Claude Code** — installed on the server machine ([install guide](https://docs.anthropic.com/en/docs/claude-code/overview)). Requires a Claude Max or Pro subscription.
- **Google Cloud account** — for OAuth (free)
- **Cloudflare account** — for the tunnel (free tier works)
- **A domain name** — for the Cloudflare tunnel endpoint
- **Vercel account** — for frontend hosting (free tier works)

## Setup Guide

### 1. Clone and Install

```bash
git clone https://github.com/scott-rippey/code-anvil-mobile-public.git
cd code-anvil-mobile-public

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
   - Note: While in testing mode, only these test users can sign in. To allow anyone, you'd need to verify your app with Google.
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

#### Install cloudflared

**macOS:**
```bash
brew install cloudflared
```

**Linux (Debian/Ubuntu):**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

**Windows (WSL):**
```bash
# Inside WSL, use the Linux instructions above
```

See the [cloudflared docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for other platforms.

#### Configure cc-server

```bash
cp cc-server/.env.example cc-server/.env
```

Edit `cc-server/.env`:
```
SHARED_SECRET=generate-a-random-string-here
BASE_DIR=/path/to/your/projects
PORT=3020
TUNNEL_TOKEN=eyJ...your-cloudflare-tunnel-token
```

Generate a secure shared secret:
```bash
openssl rand -hex 32
```

#### Start the server

**macOS (recommended):** Double-click `Start CC Server.command` — starts both the Cloudflare tunnel and cc-server with auto-restart on crash.

**Any platform (manual):**
```bash
# Terminal 1: Start the tunnel
cloudflared tunnel run --token YOUR_TUNNEL_TOKEN

# Terminal 2: Start cc-server
cd cc-server && npm run dev
```

#### Optional: Install tunnel as a system service (auto-starts on boot)

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
```

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
2. Verify the tunnel:
   ```bash
   curl https://your-tunnel-domain/health
   # Should return: {"status":"ok","timestamp":"..."}
   ```
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
| `BASE_DIR` | Root directory for file browsing and terminal |
| `PORT` | Server port (default: 3020) |
| `TUNNEL_TOKEN` | Cloudflare tunnel token |

## Usage

### Permission Modes

Switch modes using the selector above the chat input:

- **Default** — prompts for permission on dangerous operations (bash commands, etc.)
- **Accept Edits** — auto-allows file edits, still prompts for bash
- **Plan** — planning mode, no tool execution
- **Bypass** — skips ALL permission checks (requires confirmation)

Permission requests timeout after 60 seconds (warning shown at 45s).

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

Custom `.md` commands from your `.claude/commands/` directories are also available — any slash commands you've set up on the server machine work here too.

## Development

### Local Development

```bash
# Terminal 1: Start cc-server
cd cc-server && npm run dev

# Terminal 2: Start Next.js dev server with env vars pointing to local cc-server
TUNNEL_URL=http://localhost:3020 SHARED_SECRET=your-local-secret npm run dev
```

Or pull your Vercel env vars for local development:
```bash
vercel env pull .env.local  # Only for local dev — never commit this file
```

### Pre-Commit Checks

```bash
npm run build        # Next.js production build
npx tsc --noEmit     # TypeScript check
npx eslint .         # Lint check
```

All three must pass before committing — every push triggers a Vercel deploy.

## Security Considerations

- **SHARED_SECRET** should be a cryptographically random string (use `openssl rand -hex 32`). This is the only thing protecting your server from unauthorized access.
- **ALLOWED_EMAILS** restricts which Google accounts can sign in. Set this to only your own email(s).
- **BASE_DIR** controls what files cc-server can access. Set this to a specific projects directory, not your entire home folder.
- **Cloudflare Tunnel** encrypts all traffic between Vercel and your server — your server doesn't need to be directly exposed to the internet.
- **Session state persists to disk** — sessions are saved to `cc-server/data/sessions.json` (debounced writes, atomic rename). Bulky fields (model lists, init data) are ephemeral and repopulate on the next message. The `data/` directory is gitignored.

## Troubleshooting

**"Connection refused" or tunnel not working:**
- Verify cc-server is running: `curl http://localhost:3020/health`
- Verify the tunnel is running: check the cloudflared process
- Verify the tunnel hostname points to `localhost:3020` in Cloudflare dashboard

**Google sign-in fails:**
- Check that your email is in the "Test users" list in Google Cloud Console
- Verify `NEXTAUTH_URL` matches your actual Vercel domain exactly
- Verify the redirect URI in Google Cloud Console matches `https://your-app.vercel.app/api/auth/callback/google`

**Chat hangs or times out:**
- SSE streams need long-lived connections. Some corporate firewalls may interfere.
- The server sends heartbeat pings every 15s to keep connections alive through proxies.
- Check cc-server logs for errors.

**Port 3020 already in use:**
```bash
# Find and kill the process
lsof -ti :3020 | xargs kill
```

## Tech Stack

- **Frontend:** Next.js 15, Tailwind CSS, NextAuth
- **Backend:** Express, Claude Agent SDK, TypeScript (tsx)
- **Infrastructure:** Vercel, Cloudflare Tunnel
- **Auth:** Google OAuth via NextAuth

## Version History

- **v1.2.0** — SDK feature expansion: query controls (budget caps, turn limits, continue), account info, mid-query controls (model switch, thinking budget, dynamic MCP), graceful interrupt, informational hooks, bypass permissions mode, ChatSettings UI panel, structured output support, session recovery, file browser refresh. Rebranded to Code Anvil Mobile. Removed fork/undo UI (SDK limitations). 171 tests passing.
- **v1.1.0** — Session persistence (survives server restarts), graceful interrupt (two-tap stop with visual feedback). Added Vitest test suite (43 tests for new features). QueryRunner/TerminalRunner decoupled from SSE connections for reconnect support.
- **v1.0.1** — Improved README for public release: cross-platform setup (Mac/Linux/WSL), security considerations, troubleshooting guide, local dev instructions. Fixed localhost port fallback bug.
- **v1.0.0** — Initial public release. Chat, file browser, terminal, permission modes, slash commands, MCP servers, context tracking.

## License

MIT — see [LICENSE](LICENSE)
