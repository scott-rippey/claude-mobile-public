const TUNNEL_URL = process.env.TUNNEL_URL || "http://localhost:3002";
const SHARED_SECRET = process.env.SHARED_SECRET || "";

export async function serverFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = 10000
): Promise<Response> {
  const url = `${TUNNEL_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${SHARED_SECRET}`,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
