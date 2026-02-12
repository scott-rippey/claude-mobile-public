# Claude Mobile - Implementation Plan

> **Architecture:** Phone -> Vercel (Google Auth) -> Cloudflare Tunnel -> iMac local server -> Claude Agent SDK + file system

## Key URLs

- **App:** https://claudemobile-sigma.vercel.app
- **Tunnel:** https://api.claudemobile.dev
- **GitHub:** https://github.com/scott-rippey/claude-mobile

## Implementation Checklist

### Phase 1: Local Server (cc-server)

- [x] **1.1** Initialize cc-server project
- [x] **1.2** Auth middleware
- [x] **1.3** File browsing endpoints
- [x] **1.4** Chat endpoint (SSE streaming)
- [x] **1.5** macOS launcher
- [x] **1.6** Local testing

### Phase 2: Cloudflare Tunnel

- [x] **2.1** Cloudflare account + domain (claudemobile.dev)
- [x] **2.2** Create tunnel in dashboard
- [x] **2.3** Configure public hostname (api.claudemobile.dev -> localhost:3002)
- [ ] **2.4** Install cloudflared on iMac (see docs/IMAC_SETUP.md)
- [ ] **2.5** Test tunnel end-to-end

### Phase 3: Vercel Frontend

- [x] **3.1** Initialize Next.js project (moved to repo root for Vercel)
- [x] **3.2** API proxy routes
- [x] **3.3** File Browser page
- [x] **3.4** File Viewer
- [x] **3.5** Chat Interface
- [x] **3.6** Shared components
- [x] **3.7** Deploy to Vercel (claudemobile-sigma.vercel.app)

### Phase 4: Google Auth

- [x] **4.1** NextAuth setup in code
- [ ] **4.2** Google Cloud Console setup (Scott)
- [ ] **4.3** Add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to Vercel env vars
- [ ] **4.4** Add NEXTAUTH_SECRET + NEXTAUTH_URL to Vercel env vars
- [ ] **4.5** Test auth flow

### Phase 5: iMac Setup & End-to-End

- [x] **5.1** Create GitHub repo (scott-rippey/claude-mobile)
- [x] **5.2** Push code
- [x] **5.3** Connect to Vercel
- [x] **5.4** Configure env vars (TUNNEL_URL + SHARED_SECRET done)
- [ ] **5.5** Run iMac setup (see docs/IMAC_SETUP.md)
- [ ] **5.6** End-to-end test from phone

## What's Next

1. **iMac setup** — follow docs/IMAC_SETUP.md (install cloudflared, start cc-server, test tunnel)
2. **Google Auth** — set up Google Cloud Console, get OAuth credentials, add to Vercel
3. **Polish** — mobile UI tweaks, error handling, etc.
