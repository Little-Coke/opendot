import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
import { verifyTelegramToken } from "@/lib/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ChatError("请求格式不正确");
    }
    const provided = "token" in body ? (body as { token?: unknown }).token : undefined;
    const result = await verifyTelegramToken(provided);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
