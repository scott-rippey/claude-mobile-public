# Claude Code Mobile

Remote Claude Code interface — access Claude Agent SDK and your iMac's file system from your phone.

## Architecture

```
Phone → Vercel (Next.js + Google Auth)
  → API proxy routes → Cloudflare Tunnel
    → iMac Express server (cc-server, port 3020)
      → Claude Agent SDK + file system access
```

### Frontend (root — deploys to Vercel)
- **Next.js 15.5.12** app with Tailwind CSS (downgraded from 16 — v16 broke middleware auth)
- **NextAuth** with Google OAuth (only authorized users)
- **API routes** (`app/api/`) proxy requests to cc-server through Cloudflare Tunnel
- **Pages:** File browser, file viewer, chat interface, project workspace (tabbed: browse/file/chat/terminal/help)
- **Components:** `components/` — FileBrowser, FileViewer, ChatInterface, Terminal, ProjectWorkspace, LogoutButton, AuthGuard, CodeBlock, StreamingMessage, ClaudeLogo

### Backend (`cc-server/` — runs on iMac only)
- **Express** server on port 3020
- **Auth middleware** validates shared secret from Vercel API routes
- **Routes:** `/api/files`, `/api/file`, `/api/chat` (SSE streaming), `/api/chat/abort`, `/api/chat/permission`, `/api/chat/mode`, `/api/terminal` (SSE streaming)
- **Claude Agent SDK** integration for chat with `settingSources: ["project", "user"]` and `includePartialMessages: true` for token-by-token streaming
- **Built-in slash commands** (`/help`, `/context`, `/model`, `/mcp`, `/status`, `/clear`) handled server-side without calling SDK — instant responses
- **Custom .md commands** expanded from `.claude/commands/`, `~/.claude/commands/`, or global `slash commands/` folder
- **In-memory session state** tracks model, permissionMode, context tokens, context window, and cost per sessionId (lost on restart, 24h TTL with auto-cleanup)
- **Permission modes** — Default/Accept Edits/Plan switchable mid-session via UI selector; maps directly to SDK `permissionMode` values
- **SSE heartbeats** — both chat and terminal streams send keepalive pings every 15s to prevent proxy/tunnel timeouts
- **Permission timeout** — 60s with 45s warning event (mobile users respond quickly or not at all)
- **Command priority:** built-in → custom .md → pass-through to SDK (covers `/compact` and skills like `/commit`)
- Runs TypeScript directly via `tsx` — no build/compile step needed
- `Start CC Server.command` starts both Cloudflare tunnel and server with auto-restart
- `Start CC Server Local.command` starts server only (no tunnel) for local testing
- NOT deployed to Vercel — this subfolder runs locally on the iMac
- Has its own `package.json`, `tsconfig.json`, and `node_modules`

### Key Files
- `cc-server/` — excluded from root `tsconfig.json` and `eslint.config.mjs`
- `.env.example` — variable names and examples (committed)
- `cc-server/.env` — `SHARED_SECRET` and `ANTHROPIC_API_KEY` (not committed)
- `Start CC Server.command` — macOS launcher for cc-server (tunnel + server)
- `Start CC Server Local.command` — local-only launcher (server only, no tunnel)
- `docs/IMPLEMENTATION_PLAN.md` — checklist of all phases

## Environment Rules

- **Never use `.env.local`** — all env vars go in Vercel dashboard only
- `.env.example` is for documenting variable names — committed to git
- For local dev, use `vercel env pull` or test against production

## Pre-Commit Rules

**MANDATORY before every commit to GitHub:**

1. `npm run build` — full Next.js production build must pass
2. `npx tsc --noEmit` — zero TypeScript errors
3. `npx eslint .` — zero lint errors

All three must be clean before committing. Do not commit broken code — every push triggers a Vercel deploy. Fix all issues locally first.

If the local build hangs (which sometimes happens with Next.js), skip the build step only and still run the TypeScript and lint checks.

## Environment Variables

### Vercel (production)
- `TUNNEL_URL` — Cloudflare Tunnel URL to iMac (`https://api.claudemobile.dev`)
- `SHARED_SECRET` — shared auth token between Vercel and cc-server
- `NEXTAUTH_SECRET` — NextAuth session encryption
- `NEXTAUTH_URL` — Vercel app URL
- `GOOGLE_CLIENT_ID` — Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret

### cc-server (.env on iMac)
- `SHARED_SECRET` — must match Vercel's value
- `ANTHROPIC_API_KEY` — Claude API key
- `BASE_DIR` — root directory for file browsing and terminal (e.g. `/path/to/your/projects`)
- `PORT` — defaults to 3020
