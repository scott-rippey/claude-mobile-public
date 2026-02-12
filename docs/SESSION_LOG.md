# Session Log

## 2026-02-11
Built full CC Interface project: Express server (cc-server) with auth middleware, file browsing, and Claude Agent SDK chat streaming on port 3002; Next.js frontend with file browser, file viewer, chat interface, and NextAuth Google OAuth setup. Restructured project — moved Next.js app to repo root for Vercel, cc-server stays as subfolder. Fixed Vercel build (excluded cc-server from tsconfig/eslint). Deployed to Vercel (claudemobile-sigma.vercel.app), bought claudemobile.dev domain, created Cloudflare Tunnel (api.claudemobile.dev -> localhost:3002). Next: Run iMac setup (docs/IMAC_SETUP.md), Google Cloud Console OAuth, end-to-end test.
