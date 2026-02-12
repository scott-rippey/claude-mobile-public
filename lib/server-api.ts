const TUNNEL_URL = process.env.TUNNEL_URL || "http://localhost:3002";
const SHARED_SECRET = process.env.SHARED_SECRET || "";

export async function serverFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${TUNNEL_URL}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${SHARED_SECRET}`,
    },
  });
}
