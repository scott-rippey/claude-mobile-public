# Code Anvil Mobile

Remote [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) interface — access Claude Code from your phone via your Max plan subscription.

## How It Works

**This does NOT use the Anthropic API.** The server machine runs Claude Code CLI locally using a Max plan subscription. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is a Node.js wrapper that spawns and controls the local Claude Code process — same as running `claude` in a terminal, but programmatically. All usage counts against the Max plan's included allowance, not API credits.

## Architecture

```
Phone → Vercel (Next.js + Google Auth)
  → API proxy routes → Cloudflare Tunnel
    → Server machine (cc-server, port 3020)
      → Claude Agent SDK → local Claude Code CLI (Max plan)
```

### Frontend (root — deploys to Vercel)
- **Next.js 15.5.12** app with Tailwind CSS (downgraded from 16 — v16 broke middleware auth)
- **NextAuth** with Google OAuth (only authorized users)
- **API routes** (`app/api/`) proxy requests to cc-server through Cloudflare Tunnel
- **Pages:** File browser, file viewer, chat interface, project workspace (tabbed: browse/file/chat/terminal/help)
- **Components:** `components/` — FileBrowser, FileViewer, ChatInterface, Terminal, ProjectWorkspace, LogoutButton, AuthGuard, CodeBlock, StreamingMessage, StatusBar, AnvilLogo, ChatSettings, ModeSelector

### Backend (`cc-server/` — runs on your server machine)
- **Express** server on port 3020
- **Auth middleware** validates shared secret from Vercel API routes
- **Routes:**
  - `/api/files`, `/api/file` — file browsing
  - `/api/chat` (SSE streaming) — main chat endpoint
  - `/api/chat/abort` — abort/interrupt active query (supports graceful interrupt)
  - `/api/chat/permission` — respond to permission requests
  - `/api/chat/mode` — change permission mode (default, acceptEdits, plan, bypassPermissions)
  - `/api/chat/model` — change model mid-query via `response.setModel()`
  - `/api/chat/thinking` — set thinking budget via `response.setMaxThinkingTokens()`
  - `/api/chat/settings` — update session settings (budgetCapUsd, maxTurns, maxThinkingTokens)
  - `/api/chat/mcp-servers` — dynamic MCP server management via `response.setMcpServers()`
  - `/api/chat/status` — lightweight query status check
  - `/api/chat/reconnect` (SSE) — replay + subscribe to running query
  - `/api/terminal` (SSE streaming), `/api/terminal/status`, `/api/terminal/reconnect` (SSE)
- **Claude Agent SDK** integration for chat with `settingSources: ["project", "user"]` and `includePartialMessages: true` for token-by-token streaming
- **SDK features used:** `enableFileCheckpointing`, `maxBudgetUsd`, `maxTurns`, `maxThinkingTokens`, `continue`, `outputFormat`, `bypassPermissions`, `hooks` (PreToolUse, PostToolUse), `accountInfo()`, `supportedModels()`, `mcpServerStatus()`, `interrupt()`, `setModel()`, `setMaxThinkingTokens()`, `setMcpServers()`, `setPermissionMode()`
- **Built-in slash commands** (`/help`, `/context`, `/model`, `/mcp`, `/status`, `/clear`) handled server-side without calling SDK — instant responses
- **Custom .md commands** expanded from `.claude/commands/`, `~/.claude/commands/`, or global `slash commands/` folder
- **Session persistence** via `session-store.ts` — debounced disk writes, loaded on startup, SIGTERM/SIGINT flush
- **Permission modes** — Default/Accept Edits/Plan/Bypass switchable mid-session via UI selector; maps directly to SDK `permissionMode` values
- **SSE heartbeats** — both chat and terminal streams send keepalive pings every 15s to prevent proxy/tunnel timeouts
- **QueryRunner** (`cc-server/src/query-runner.ts`) — decouples query execution from SSE connection lifetime; buffers events with sequential indices, supports listener subscribe/unsubscribe, replay-from-index for reconnection, 2000-event cap with FIFO eviction, 5min TTL cleanup for completed runners
- **TerminalRunner** — same pattern for terminal commands; process survives client disconnect, orphaned processes auto-killed after 30min
- **Permission timeout** — 60s with 45s warning event (mobile users respond quickly or not at all)
- **Command priority:** built-in → custom .md → pass-through to SDK (covers `/compact` and skills like `/commit`)
- Runs TypeScript directly via `tsx` — no build/compile step needed
- `Start CC Server.command` starts both Cloudflare tunnel and server with auto-restart
- `Start CC Server Local.command` starts server only (no tunnel) for local testing
- NOT deployed to Vercel — this subfolder runs on your server machine (Mac, Linux, or WSL on Windows)
- Has its own `package.json`, `tsconfig.json`, and `node_modules`

### Session State Fields
```
model, permissionMode, totalCostUsd, messageCount, contextTokens, contextWindow,
lastActivity, checkpoints[], budgetCapUsd?, maxTurns?, maxThinkingTokens?,
forkedFrom?, supportedModels? (ephemeral), accountInfo? (ephemeral), lastInit? (ephemeral)
```

### SSE Event Types
```
query_start, init, assistant, tool_call, tool_result, tool_progress,
stream_event, context_update, compact_boundary, system, result, error, done,
permission_request, permission_warning, supported_models, mcp_status,
account_info, hook_pre_tool_use, hook_post_tool_use, buffer_gap, reconnect_complete
```

### Key Files
- `cc-server/` — excluded from root `tsconfig.json` and `eslint.config.mjs`
- `.env.example` — variable names and examples (committed)
- `cc-server/.env` — `SHARED_SECRET`, `TUNNEL_TOKEN`, etc. (not committed)
- `Start CC Server.command` — macOS launcher for cc-server (tunnel + server)
- `Start CC Server Local.command` — local-only launcher (server only, no tunnel)

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
- `TUNNEL_URL` — Cloudflare Tunnel URL to your server (e.g. `https://api.yourdomain.com`)
- `SHARED_SECRET` — shared auth token between Vercel and cc-server
- `NEXTAUTH_SECRET` — NextAuth session encryption
- `NEXTAUTH_URL` — Vercel app URL
- `GOOGLE_CLIENT_ID` — Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret

### cc-server (.env on server machine)
- `SHARED_SECRET` — must match Vercel's value
- `BASE_DIR` — root directory for file browsing and terminal (e.g. `/path/to/your/projects`)
- `PORT` — defaults to 3020
- `TUNNEL_TOKEN` — Cloudflare tunnel token (used by `Start CC Server.command`)

