import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

// Reconnect streams can run for minutes
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    // SSE stream — no timeout
    const res = await serverFetch(
      "/api/terminal/reconnect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      0
    );

    if (!res.ok) {
      const data = await res.json();
      return Response.json(data, { status: res.status });
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
    return Response.json(
      { error: "Failed to connect to server" },
      { status: 502 }
    );
  }
}
