import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

// SDK initialization (MCP servers, plugins) can take 30s+
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    // SSE streams run for minutes — no timeout
    const res = await serverFetch(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      0
    );

    if (!res.ok) {
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pass through the SSE stream
    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to connect to server" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
