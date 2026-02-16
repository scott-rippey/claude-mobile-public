import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const commandId = request.nextUrl.searchParams.get("commandId");
  if (!commandId) {
    return Response.json({ error: "commandId is required" }, { status: 400 });
  }

  try {
    const res = await serverFetch(`/api/terminal/status?commandId=${encodeURIComponent(commandId)}`);

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
