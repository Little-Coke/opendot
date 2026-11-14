import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
import { getWorkStore } from "@/lib/work";
import { isWorkId } from "@/lib/work-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ id: string }> };

async function goalId(context: Context) {
  const { id } = await context.params;
  if (!isWorkId(id)) throw new ChatError("找不到这个委托", 404);
  return id;
}

export async function GET(request: Request, context: Context) {
  try {
    requireAccess(request);
    const detail = getWorkStore().detail(await goalId(context));
    if (!detail) throw new ChatError("找不到这个委托", 404);
    return Response.json(detail, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const detail = getWorkStore().apply(await goalId(context), await readJson(request));
    return Response.json(detail, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
