# iMac Setup Guide

Everything needed to get cc-server and Cloudflare Tunnel running on the iMac.

## Prerequisites

- Homebrew installed
- Node.js installed
- Claude Code CLI installed and authenticated (Max subscription)
- This project synced via Syncthing

---

## Step 1: Verify the project path

Open Terminal on the iMac and check where the project lives:

```bash
ls ~/App\ Development/Personal/CC\ Interface/cc-server
```

If that works, your BASE_DIR is correct. If NOT, find the actual path and update `cc-server/.env`:

```bash
nano ~/App\ Development/Personal/CC\ Interface/cc-server/.env
```

Make sure `BASE_DIR` points to the iMac's equivalent of `/Users/YOURUSERNAME/App Development` (the parent folder where all your projects live).

---

## Step 2: Install cc-server dependencies

```bash
cd ~/App\ Development/Personal/CC\ Interface/cc-server
npm install
```

This installs node_modules locally on the iMac (these may not sync properly via Syncthing).

---

## Step 3: Test cc-server runs

```bash
cd ~/App\ Development/Personal/CC\ Interface/cc-server
npm run dev
```

You should see:
```
CC Server running on http://localhost:3002
Base directory: /Users/scottrippey/App Development
```

Press `Ctrl+C` to stop it once confirmed.

---

## Step 4: Install Cloudflare Tunnel

Run the first command you copied from the Cloudflare dashboard:

```bash
brew install cloudflared
```

Then run the service install command (this starts the tunnel automatically on boot):

```bash
sudo cloudflared service install YOUR_TOKEN_HERE
```

Replace `YOUR_TOKEN_HERE` with the full token string starting with `eyJhIjoiZW...` that you copied from the Cloudflare dashboard.

If you prefer to run the tunnel manually instead of as a service:

```bash
cloudflared tunnel run --token YOUR_TOKEN_HERE
```

---

## Step 5: Verify tunnel is connected

Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) > Networks > Connectors > Cloudflare Tunnels.

Your tunnel should show as **Healthy**.

---

## Step 6: Start cc-server and test end-to-end

Start the server:

```bash
cd ~/App\ Development/Personal/CC\ Interface/cc-server
npm run dev
```

Then from your phone or any browser, test:

```
https://api.claudemobile.dev/health
```

Should return: `{"status":"ok","timestamp":"..."}`

Then test the app:

```
https://claudemobile-sigma.vercel.app
```

---

## Running daily

If you installed cloudflared as a service (Step 4 with `sudo`), the tunnel starts automatically on boot. You only need to start cc-server:

**Option A:** Double-click `Start CC Server.command` in Finder

**Option B:** Terminal:
```bash
cd ~/App\ Development/Personal/CC\ Interface/cc-server
npm run dev
```

---

## Troubleshooting

**Tunnel shows Inactive/Down:**
- Check cloudflared is running: `brew services list | grep cloudflared`
- Restart it: `sudo launchctl start com.cloudflare.cloudflared`

**cc-server won't start:**
- Run `npm install` in cc-server/ (node_modules may not sync)
- Check `.env` exists and has correct values

**"Cannot find module" errors:**
- Delete `node_modules` and run `npm install` again

**BASE_DIR wrong:**
- Check your iMac username: `whoami`
- Update `cc-server/.env` with the correct path: `BASE_DIR=/Users/YOURUSERNAME/App Development`
