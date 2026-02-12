import type { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.SHARED_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfigured: no SHARED_SECRET" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== secret) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  next();
}
