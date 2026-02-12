import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
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
      let parsed: { error?: string } | null = null;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        // not JSON
      }
      const errorMsg = parsed?.error || rawBody || `cc-server returned ${res.status}`;
      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Pass through the SSE stream
    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[terminal proxy] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: `Failed to connect to cc-server: ${msg}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
