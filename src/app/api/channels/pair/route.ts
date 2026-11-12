import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
import { issuePairCode, submitPairCommand } from "@/lib/channels";

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
    if (action === "issue") {
      return Response.json(issuePairCode((body as { channelId?: unknown }).channelId), { headers });
    }
    if (action === "submit") {
      return Response.json(submitPairCommand((body as { text?: unknown }).text), { headers });
    }
    throw new ChatError("无法识别的配对操作");
  } catch (error) {
    return errorResponse(error);
  }
}
