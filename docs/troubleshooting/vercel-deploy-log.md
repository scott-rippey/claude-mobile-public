> next build
Attention: Next.js now collects completely anonymous telemetry regarding usage.
This information is used to shape Next.js' roadmap and prioritize features.
You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
https://nextjs.org/telemetry
▲ Next.js 16.1.6 (Turbopack)
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
  Creating an optimized production build ...
✓ Compiled successfully in 1970.1ms
  Running TypeScript ...
Failed to compile.
./cc-server/src/auth-middleware.ts:1:54
Type error: Cannot find module 'express' or its corresponding type declarations.
> 1 | import type { Request, Response, NextFunction } from "express";
    |                                                      ^
  2 |
  3 | export function authMiddleware(
  4 |   req: Request,
Next.js build worker exited with code: 1 and signal: null
Error: Command "npm run build" exited with 1