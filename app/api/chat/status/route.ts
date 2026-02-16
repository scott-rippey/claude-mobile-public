import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    const res = await serverFetch(`/api/chat/status?sessionId=${encodeURIComponent(sessionId)}`);

    if (!res.ok) {
      const data = await res.json();
      return Response.json(data, { status: res.status });
    }

    return Response.json(await res.json());
  } catch {
    return Response.json(
      { error: "Failed to connect to server" },
      { status: 502 }
    );
  }
}
