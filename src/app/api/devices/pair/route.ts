import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
import { issueDeviceCode, simulateLocalNode } from "@/lib/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ChatError("请求格式不正确");
    }
    const action = (body as { action?: unknown }).action;
    if (action === "issue") return Response.json(issueDeviceCode(), { headers });
    if (action === "simulate") {
      return Response.json(simulateLocalNode(body), { status: 201, headers });
    }
    throw new ChatError("无法识别的设备操作");
  } catch (error) {
    return errorResponse(error);
  }
}
