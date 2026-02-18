import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authMiddleware } from "./auth-middleware.js";
import type { Request, Response, NextFunction } from "express";

function createMocks(options: { authorization?: string } = {}) {
  const req = {
    headers: {
      ...(options.authorization !== undefined
        ? { authorization: options.authorization }
        : {}),
    },
  } as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe("authMiddleware", () => {
  const originalEnv = process.env.SHARED_SECRET;

  beforeEach(() => {
    process.env.SHARED_SECRET = "test-secret-123";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SHARED_SECRET = originalEnv;
    } else {
      delete process.env.SHARED_SECRET;
    }
  });

  it("returns 500 when SHARED_SECRET is not set", () => {
    delete process.env.SHARED_SECRET;
    const { req, res, next } = createMocks({
      authorization: "Bearer anything",
    });

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("SHARED_SECRET") })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is missing", () => {
    const { req, res, next } = createMocks({});

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for non-Bearer scheme", () => {
    const { req, res, next } = createMocks({
      authorization: "Basic dXNlcjpwYXNz",
    });

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when token does not match secret", () => {
    const { req, res, next } = createMocks({
      authorization: "Bearer wrong-token",
    });

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid token" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when token matches secret", () => {
    const { req, res, next } = createMocks({
      authorization: "Bearer test-secret-123",
    });

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
