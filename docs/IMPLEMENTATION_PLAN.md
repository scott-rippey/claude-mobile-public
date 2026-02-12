# CC Interface - Implementation Plan

> **Architecture:** Phone -> Vercel (Google Auth) -> Cloudflare Tunnel -> iMac local server -> Claude Agent SDK + file system

## Implementation Checklist

### Phase 1: Local Server (cc-server)

- [x] **1.1** Initialize cc-server project
- [x] **1.2** Auth middleware
- [x] **1.3** File browsing endpoints
- [x] **1.4** Chat endpoint (SSE streaming)
- [x] **1.5** macOS launcher
- [x] **1.6** Local testing

### Phase 2: Cloudflare Tunnel (Manual Setup)

- [ ] **2.1** Install cloudflared
- [ ] **2.2** Create tunnel
- [ ] **2.3** Configure tunnel -> localhost:3002
- [ ] **2.4** Test tunnel
- [ ] **2.5** Add tunnel to launcher script

### Phase 3: Vercel Frontend (cc-app)

- [x] **3.1** Initialize Next.js project
- [x] **3.2** API proxy routes
- [x] **3.3** File Browser page
- [x] **3.4** File Viewer
- [x] **3.5** Chat Interface
- [x] **3.6** Shared components
- [ ] **3.7** Local testing

### Phase 4: Google Auth

- [x] **4.1** NextAuth setup
- [ ] **4.2** Google Cloud Console setup (Scott)
- [ ] **4.3** Test auth flow

### Phase 5: Deploy & Connect

- [ ] **5.1** Create GitHub repo
- [ ] **5.2** Push code
- [ ] **5.3** Connect to Vercel
- [ ] **5.4** Configure env vars
- [ ] **5.5** Start server on iMac
- [ ] **5.6** Start Cloudflare tunnel
- [ ] **5.7** End-to-end test from phone
