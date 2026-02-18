# Sandbox Agents — Why and How

## The Problem

As a solo developer, you write code and Claude Code helps — but it's always in your live working directory. If an agent makes a mess, it's your mess to clean up. And without tests, the only QA is you eyeballing the code and deciding if it looks right.

This limits what you're willing to let agents do. You keep them on a short leash: reporting, analysis, suggestions. They could do more, but the risk isn't worth it.

## The Solution: Sandboxed Agents

A sandbox is a disposable isolated environment where an agent gets a copy of your repo and full autonomy to work. It can install packages, write code, run tests, iterate on failures — all without touching your local project.

Nothing enters your codebase until you explicitly review and merge it.

## How It Works

```
You: "Add OAuth support to the API"
  → Clone repo into ~/sandbox-workspace/ (separate from your real project)
  → Docker Sandbox spins up on your machine
    → Works on the separate clone (your real project is untouched)
    → Claude Code runs autonomously (uses your Max plan, not API calls)
    → Agent writes the code
    → Agent writes tests that prove it works
    → Agent runs the full quality gate:
        - npm run build (must pass)
        - tsc --noEmit (must pass)
        - eslint (must pass)
        - npm test (must pass)
    → Agent iterates until everything passes
    → Pushes a feature branch to GitHub
  → Sandbox + temp clone get deleted
You: review the branch/PR on GitHub — code is already validated
You: merge to dev branch or delete the branch — your choice
Nothing touches your local project until YOU merge.
```

## Pre-flight Checks

Before running any sandbox task, Claude Code should verify the environment is ready. Run these checks automatically — don't ask, just check.

```bash
# 1. Docker Desktop installed and running?
docker info > /dev/null 2>&1 || echo "FAIL: Docker not running"

# 2. Docker sandbox feature available? (requires Docker Desktop 4.58+)
docker sandbox ls > /dev/null 2>&1 || echo "FAIL: docker sandbox not available (need Docker Desktop 4.58+)"

# 3. OAuth token set? (for Max plan auth)
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || echo "FAIL: CLAUDE_CODE_OAUTH_TOKEN not set"

# 4. GitHub auth available? (needed to push branches from sandbox)
[ -n "$GITHUB_TOKEN" ] || gh auth status > /dev/null 2>&1 || echo "FAIL: No GitHub auth — set GITHUB_TOKEN or run gh auth login"

# 5. sandbox-workspace directory exists?
[ -d ~/sandbox-workspace ] || echo "FAIL: ~/sandbox-workspace not found"
```

### If a check fails — fix it automatically

Don't stop and ask the user. Try to fix it, then re-check.

| Check | Auto-fix |
|-------|----------|
| Docker not installed | Download Docker Desktop DMG for the current platform (Apple Silicon / Intel Mac), mount, copy to /Applications, unmount, launch. User approves one macOS security prompt. |
| Docker not running | `open -a Docker` and wait up to 60s for `docker info` to succeed |
| `docker sandbox` not available | Docker Desktop is too old — tell the user to update to 4.58+ (can't auto-update) |
| OAuth token missing | Run `claude setup-token`, capture the token, add `export CLAUDE_CODE_OAUTH_TOKEN=<token>` to `~/.zshrc`, source it |
| GitHub auth missing | If `GITHUB_TOKEN` is already in `~/.zshrc` but not exported in current shell, source it. Otherwise tell the user to create a PAT at https://github.com/settings/tokens (needs "repo" scope) and add it to `~/.zshrc` |
| sandbox-workspace missing | `mkdir -p ~/sandbox-workspace` |

After fixing, re-run the checks. Also run `launchctl setenv` for each token (see One-Time Setup) since Docker Desktop reads env vars from launchd, not your shell.

### Critical: How env vars reach the sandbox

Docker Desktop does **NOT** pass host env vars (`~/.zshrc`) into sandbox VMs automatically. The `docker sandbox run claude` command launches Claude Code directly — no login shell, no `.bashrc`, no `.profile`.

**Working approach:** Use `docker sandbox create` + `docker sandbox exec -e` to inject env vars at runtime:

```bash
docker sandbox create --name my-sandbox claude ~/sandbox-workspace/my-project
docker sandbox exec \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  my-sandbox \
  claude --dangerously-skip-permissions -p "<your prompt>"
```

**Why `docker sandbox run` doesn't work for auth:** It starts Claude Code as a direct process (not through bash), ignores host env vars, and has no `-e` flag. The `exec` command does support `-e`.

### Known gotchas

1. **Fresh Docker Desktop install returns 500 errors** — The VM needs a clean restart. Fully quit Docker Desktop (Cmd+Q), then reopen. If 500s persist, force-kill all Docker processes (`pkill -9 -f Docker`), delete the stuck VM data (`rm -rf ~/Library/Containers/com.docker.docker/Data/vms/0`), and relaunch.
2. **Claude Code auto-updates inside the sandbox** — On first run it may download a newer version, which can overwrite wrapper scripts. Use `exec -e` to inject env vars (not wrapper scripts).
3. **`docker sandbox exec` only works with `create`-based sandboxes** — If you used `docker sandbox run` to create it, `exec` won't find it. Always use `create` first, then `exec`.
4. **`claude setup-token` must run outside Claude Code** — Prefix with `CLAUDECODE=` if running from a Claude Code terminal: `CLAUDECODE= claude setup-token`
5. **Docker Desktop needs `launchctl setenv` on macOS** — GUI apps don't read `~/.zshrc`. Set tokens via both `~/.zshrc` (for your shell) and `launchctl setenv` (for Docker Desktop).

### Per-project setup is minimal

Once Docker + auth are configured on a machine, running a sandbox for any project is just:

```bash
git clone <repo-url> ~/sandbox-workspace/<project-name>
docker sandbox create --name <sandbox-name> claude ~/sandbox-workspace/<project-name>
docker sandbox exec \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  <sandbox-name> \
  claude --dangerously-skip-permissions -p "<prompt>"
```

No project-specific configuration needed. The sandbox reads the project's CLAUDE.md for conventions, installs its own deps, and works autonomously.

## Why This Matters

### Before (current workflow)
- Agent writes code in your working directory
- You manually review if it looks correct
- No tests — you're the QA
- If it breaks something, you're fixing it in your live project
- You limit agents to safe, small tasks

### After (sandbox workflow)
- Agent works in an isolated throwaway environment
- Agent writes tests that prove the code works
- Agent can't push until build, typecheck, lint, and tests all pass
- You only see clean, validated code in a PR
- You can give agents bigger, more ambitious tasks
- You keep working on something else while the agent runs

### The test angle
You've never had Claude Code write tests before. Sandboxed agents change that equation:

- The agent writes tests as part of every task — it's baked into the instructions
- Tests validate the code actually does what it's supposed to do (not just that it compiles)
- Those tests come back into your codebase with the PR
- Future changes that break the feature get caught automatically
- You go from "looks right" to "proven right"

---

## Quickstart: Get Running Tonight

Do these steps in order on your Mac. Total setup time: ~10 minutes.

### One-Time Setup

```bash
# 1. Install Docker Desktop 4.58+ (skip if already installed)
#    Download from: https://www.docker.com/products/docker-desktop/
#    After install: open Docker Desktop, accept the license, wait for engine to start
#    First launch may return 500 errors — if so, fully quit Docker Desktop
#    (Cmd+Q or right-click whale icon → Quit) and reopen it.
#    Verify: docker info > /dev/null 2>&1 && echo "OK"

# 2. Get your Max plan OAuth token
#    Run in a terminal (NOT inside Claude Code):
CLAUDECODE= claude setup-token
#    It opens a browser → authorize → it prints a token starting with sk-ant-oat01-...
#    Copy the entire token.

# 3. Add tokens to your shell config
echo 'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...' >> ~/.zshrc
echo 'export GITHUB_TOKEN=ghp_...' >> ~/.zshrc
source ~/.zshrc
#    GitHub PAT: create at https://github.com/settings/tokens (needs "repo" scope)
#    Or extract from a git remote URL if you already have one embedded.

# 4. Also set tokens in macOS launchd (Docker reads from here, not ~/.zshrc):
launchctl setenv CLAUDE_CODE_OAUTH_TOKEN "$CLAUDE_CODE_OAUTH_TOKEN"
launchctl setenv GITHUB_TOKEN "$GITHUB_TOKEN"

# 5. Restart Docker Desktop to pick up the launchd env vars
#    Quit Docker Desktop (Cmd+Q) then reopen from Applications.

# 6. Create the sandbox workspace directory
mkdir -p ~/sandbox-workspace

# 7. Verify everything:
docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: FAIL"
docker sandbox ls > /dev/null 2>&1 && echo "Sandbox: OK" || echo "Sandbox: FAIL"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] && echo "OAuth: OK" || echo "OAuth: FAIL"
[ -n "$GITHUB_TOKEN" ] && echo "GitHub: OK" || echo "GitHub: FAIL"
```

### Running a Sandbox (Fully Isolated — Nothing Touches Your Code Until You Merge)

The agent works in a **completely separate clone**. Your real project directory is never touched. You only pull changes in after reviewing the branch on GitHub.

**Important:** `docker sandbox run` does NOT pass host env vars into the sandbox. Use `docker sandbox create` + `docker sandbox exec -e` instead.

```bash
# 1. Clone your project into the sandbox workspace
#    This is a SEPARATE copy — your real project is untouched
git clone https://github.com/YOUR_USER/YOUR_REPO.git ~/sandbox-workspace/YOUR_REPO

# 2. Create the sandbox (downloads the sandbox image on first run)
docker sandbox create --name my-task claude ~/sandbox-workspace/YOUR_REPO

# 3. Run Claude Code with env vars injected via exec -e
docker sandbox exec \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  my-task \
  claude --dangerously-skip-permissions -p \
  "Create a feature branch called sandbox/auth-tests. \
   Add unit tests for the auth module. \
   Run: npm install, npm run build, npx tsc --noEmit, npx eslint ., npm test. \
   If all pass, commit and push the branch to origin. \
   If anything fails, fix it and retry until everything passes. \
   Report the final results."

# 4. Agent works autonomously inside the sandbox:
#    - Installs deps in the VM (not on your machine)
#    - Writes code + tests
#    - Runs quality gates
#    - Iterates until everything passes
#    - Pushes a branch to GitHub

# 5. Review the branch on GitHub
#    Go to your repo → branches → sandbox/auth-tests
#    Look at the diff, the test files, the commit messages
#    Open a PR if you want a cleaner review flow

# 6. If you like it:
#    Merge the branch into your dev branch (via GitHub PR or locally)

# 7. If you don't like it:
#    Delete the branch on GitHub: git push origin --delete sandbox/auth-tests
#    Nothing ever touched your local project

# 8. Clean up
rm -rf ~/sandbox-workspace/YOUR_REPO
docker sandbox rm my-task
```

### Why This Is Safe

- Your real project directory (`~/App Development/Personal/...`) is **never mounted** into the sandbox
- The sandbox works on a **separate clone** in `~/sandbox-workspace/`
- Changes only reach your real project when **you merge the branch** on GitHub
- If the agent writes garbage, you delete the branch and the temp clone — zero impact
- Your SyncThing-synced directories, your worktrees, your node_modules — all untouched

### Interactive Mode (If You Want to Watch / Guide)

Instead of fire-and-forget, you can open an interactive sandbox session:

```bash
# Clone into sandbox workspace
git clone https://github.com/YOUR_USER/YOUR_REPO.git ~/sandbox-workspace/YOUR_REPO

# Create the sandbox
docker sandbox create --name interactive-task claude ~/sandbox-workspace/YOUR_REPO

# Start interactive session with env vars
docker sandbox exec -it \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  interactive-task \
  claude

# Now you're in a Claude Code session inside the sandbox.
# You can type prompts, review what the agent does, approve/reject step by step.
# When done, the agent pushes a branch, you review on GitHub.
```

### Quick Reference

```bash
# List running sandboxes
docker sandbox ls

# Shell into a sandbox (to inspect files, run commands manually)
docker sandbox exec -it <sandbox-name> bash

# Remove a sandbox
docker sandbox rm <sandbox-name>

# Remove ALL sandboxes (clean slate)
docker sandbox ls -q | xargs -I{} docker sandbox rm {}
```

---

## Recommended Approach: Docker Sandboxes

> After evaluating E2B (cloud sandboxes) and Docker Sandboxes (local), Docker Sandboxes is the clear winner for a solo developer on a Max plan. E2B requires pay-per-token API calls (Opus is ~$15/$75 per million input/output tokens — a single task could cost $5-20). Docker Sandboxes use your existing Max plan subscription at no additional cost.

### What Docker Sandboxes Are

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) is a first-party Docker Desktop feature (v4.58+) that runs AI coding agents in isolated microVMs on your local machine. Each sandbox is a lightweight VM with its own Docker daemon, filesystem, and network — the agent cannot access your host system, other containers, or files outside the designated workspace.

**Key properties:**
- **Free** — included with Docker Desktop, no usage fees
- **Uses your Max plan** — Claude Code authenticates with your subscription, no API key costs
- **Local compute** — runs on your MacBook's hardware
- **microVM isolation** — not just a container, a full VM with its own kernel
- **Workspace sync** — your project directory syncs into the sandbox at the same absolute path
- **Persistence** — sandboxes persist until you delete them (installed packages survive between sessions)

Official docs:
- [Docker Sandboxes Overview](https://docs.docker.com/ai/sandboxes)
- [Getting Started](https://docs.docker.com/ai/sandboxes/get-started/)
- [Configure Claude Code](https://docs.docker.com/ai/sandboxes/claude-code/)

### Prerequisites

1. **Docker Desktop 4.58 or later** — [download here](https://www.docker.com/products/docker-desktop/)
2. **macOS** (required for microVM sandboxes; Windows is experimental)
3. **Claude Max plan** (the $200/month plan you already have)

### Authentication: Using Max Plan in Docker Sandboxes

Docker Sandboxes can use your Max plan instead of API keys. From [this guide](https://www.sabatino.dev/docker-sandbox-with-claude-code-max-plan/):

**Step 1: Get your OAuth token**

Run on your host machine:
```bash
claude setup-token
```

This produces an OAuth token. Export it in your shell config (`~/.zshrc`):
```bash
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-...
```

**Step 2: Ensure onboarding flag is set**

In `~/.claude.json`, make sure `hasCompletedOnboarding` is set to `true`. This tells Claude Code to accept the OAuth token without prompting for login.

**Step 3: Restart Docker Desktop**

After setting the env var and sourcing your shell config, restart Docker Desktop so it picks up the token.

### Running a Sandbox

**Important:** Don't use `docker sandbox run claude <workspace> -- "<prompt>"` for authenticated sessions. That command doesn't pass env vars. Use the create + exec pattern instead:

```bash
# Create the sandbox
docker sandbox create --name my-task claude ~/path/to/your/project

# Run Claude Code with auth
docker sandbox exec \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  my-task \
  claude --dangerously-skip-permissions -p "Add unit tests for the auth module"
```

**What happens:**
1. Docker creates a lightweight microVM
2. Your project directory syncs into the VM
3. `exec -e` injects your auth tokens into the process environment
4. Claude Code launches inside the VM with your Max plan auth
5. Agent works autonomously — installs packages, writes code, runs tests
6. Changes sync back to your workspace

### Managing Sandboxes

```bash
# List all sandboxes
docker sandbox ls

# Shell into a running sandbox
docker sandbox exec -it <sandbox-name> bash

# Remove a sandbox when done
docker sandbox rm <sandbox-name>
```

Note: sandboxes don't appear in `docker ps` — they're VMs, not containers.

### What's Inside the Sandbox

The sandbox base environment includes ([from Docker docs](https://docs.docker.com/ai/sandboxes/claude-code/)):
- Ubuntu-based environment
- Node.js, Python 3, Go
- Git, GitHub CLI
- Docker CLI (with its own isolated Docker daemon)
- Claude Code pre-installed
- Non-root `agent` user with sudo privileges

### CLAUDE.md and Project Conventions

Your project's CLAUDE.md is automatically available — workspace sync copies your entire project directory into the sandbox, including CLAUDE.md. The agent follows your conventions because it reads the same project instructions it would locally.

For your global `~/.claude/CLAUDE.md`, you can shell into the sandbox and write it manually, or include it as part of the prompt instructions.

### GitHub Authentication in the Sandbox

For the agent to push branches and open PRs, it needs GitHub access. The working approach:

**Pass `GITHUB_TOKEN` via `exec -e`** — this is the only reliable method. The sandbox's `git` and `gh` will automatically use it.

```bash
docker sandbox exec -e GITHUB_TOKEN="$GITHUB_TOKEN" my-sandbox git push origin my-branch
```

Other approaches that **don't reliably work**:
- Setting env vars in `~/.zshrc` on the host (Docker doesn't pass them through)
- `gh auth login` inside the sandbox (requires interactive browser flow)
- Mounting host `~/.gitconfig` (not supported by Docker sandboxes)

---

## Alternative: Claude Code Native Sandboxing

Claude Code also has built-in sandboxing that doesn't require Docker at all.

From [Claude Code docs on sandboxing](https://code.claude.com/docs/en/sandboxing):

### How It Works

Run `/sandbox` in Claude Code to enable it. It uses OS-level primitives:
- **macOS**: Uses Apple's Seatbelt framework (built-in, nothing to install)
- **Linux**: Uses bubblewrap
- **WSL2**: Uses bubblewrap

### What It Provides

**Filesystem isolation:**
- Read/write access restricted to the current working directory
- Cannot modify files outside your project
- Cannot touch system files, `~/.bashrc`, etc.

**Network isolation:**
- Only approved domains can be accessed
- New domain requests trigger permission prompts
- All scripts and subprocesses inherit the restrictions

### Sandbox Modes

**Auto-allow mode**: Commands inside the sandbox run without permission prompts. Commands that need access outside the sandbox fall back to normal permission flow.

**Regular permissions mode**: All commands go through standard approval, even when sandboxed. More control, more prompts.

### When to Use Native vs Docker

| | Native Sandboxing | Docker Sandboxes |
|---|---|---|
| **Isolation** | OS-level (Seatbelt/bubblewrap) | Full microVM |
| **Setup** | Zero — built into Claude Code | Docker Desktop 4.58+ |
| **Works in same directory** | Yes — restricts what it can touch | No — copies project into VM |
| **Separate environment** | No — shares your node_modules, etc. | Yes — fresh install |
| **Best for** | Day-to-day coding with guardrails | Fire-and-forget autonomous tasks |

**For your agentic coding use case** (fire off a task, agent works autonomously, pushes a branch), Docker Sandboxes is the right choice. The agent gets a completely separate environment to experiment in.

**For regular assisted coding** (you're working alongside Claude Code), native sandboxing with `/sandbox` is simpler and faster.

---

## E2B (Cloud Sandboxes) — For Reference

> E2B was initially considered but **requires Anthropic API keys** (pay-per-token), not compatible with the Max plan. Included here for reference in case API pricing changes or you need cloud-based sandboxes in the future.

[E2B](https://e2b.dev/) provides cloud-hosted sandboxes with an [official Claude Code template](https://e2b.dev/docs/template/examples/claude-code). Key facts:

- **Pricing**: Free hobby tier with $100 in credits, per-second billing (~$0.02 per 10-min task in compute)
- **But**: Requires `ANTHROPIC_API_KEY` — Opus API costs make this expensive ($5-20+ per coding task)
- **Template**: Node.js 24 + curl + git + ripgrep + Claude Code globally installed
- **Customizable**: 1-8 vCPUs, 512-8192 MiB RAM (use 2 vCPU / 2 GiB minimum for real projects)
- **SDK**: JavaScript and Python SDKs for orchestration
- **Use case**: Better suited for teams with API budgets, or for using cheaper models (Sonnet/Haiku) in sandboxes

Official docs:
- [E2B Documentation](https://e2b.dev/docs)
- [E2B Claude Code Template](https://e2b.dev/docs/template/examples/claude-code)
- [E2B Pricing](https://e2b.dev/pricing)
- [E2B SDK (GitHub)](https://github.com/e2b-dev/E2B)

---

## What You Need to Get Started

1. **Docker Desktop 4.58+** — [download](https://www.docker.com/products/docker-desktop/) (you may already have it)
2. **Max plan OAuth token** — run `claude setup-token`, export as `CLAUDE_CODE_OAUTH_TOKEN`
3. **GitHub access** — for pushing branches from the sandbox (`gh auth login` or PAT)
4. **CLAUDE.md documentation** — global `~/.claude/CLAUDE.md` entry so Claude Code on any machine knows how to invoke sandbox tasks via natural language

## Day-to-Day Usage

You never type Docker commands directly. You talk to Claude Code naturally:

> "Spin up a sandbox to add integration tests for the file browser API"

> "Run a sandboxed agent to refactor the auth middleware and add error handling tests"

> "Fire off an agent in a sandbox to add dark mode support"

Claude Code reads your CLAUDE.md, sees the sandbox documentation, runs `docker sandbox run claude` for you. You get a branch/PR link back when it's done.

## Architecture Fit

```
Your real project (iMac / MacBook / PC)
  ↕ SyncThing (keeps projects in sync across machines)
  ↕ Git (dev branch worktree = working copy, main = clean)
  ✗ NEVER mounted into a sandbox

~/sandbox-workspace/ (temporary, disposable)
  → Fresh git clone from GitHub
  → Mounted into Docker Sandbox (microVM)
  → Claude Code runs autonomously (Max plan)
  → Runs quality gates (build, typecheck, lint, test)
  → Pushes feature branch to GitHub
  → You review on GitHub
  → Merge to dev (or delete the branch)
  → Delete ~/sandbox-workspace/ clone when done
```

Your real project directories are never exposed to the sandbox. The agent only interacts with a disposable clone. Changes reach your real codebase exclusively through Git merges that you initiate.

## References

- [Docker Sandboxes Overview](https://docs.docker.com/ai/sandboxes)
- [Docker Sandboxes Getting Started](https://docs.docker.com/ai/sandboxes/get-started/)
- [Configure Claude Code in Docker Sandbox](https://docs.docker.com/ai/sandboxes/claude-code/)
- [Docker Blog: Run Claude Code Safely](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
- [Max Plan in Docker Sandbox Guide](https://www.sabatino.dev/docker-sandbox-with-claude-code-max-plan/)
- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing)
- [Claude Code DevContainers](https://code.claude.com/docs/en/devcontainer)
- [E2B Documentation](https://e2b.dev/docs) (cloud alternative, requires API key)
- [E2B Claude Code Template](https://e2b.dev/docs/template/examples/claude-code)
- [GitHub PAT Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
