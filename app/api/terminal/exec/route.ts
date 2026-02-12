import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const res = await serverFetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Read body as text first — can only consume once
      const rawBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(rawBody);
        errorMsg = parsed.error || rawBody;
      } catch {
        errorMsg = rawBody || `cc-server returned ${res.status}`;
      }
      return Response.json({ error: errorMsg }, { status: res.status });
    }

    // Pass through the SSE stream directly (same pattern as chat route)
    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[terminal proxy] error:", err);
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    const msg = isTimeout
      ? "cc-server is not reachable (connection timed out)"
      : err instanceof Error
        ? err.message
        : "Unknown error";
    return Response.json(
      { error: `Failed to connect to cc-server: ${msg}` },
      { status: 502 }
    );
  }
}
