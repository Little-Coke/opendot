import { errorResponse, requireAccess, requireSameOrigin } from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
import { getDotStore } from "@/lib/dots";
import { CUSTOM_DOT_RECENT, defaultModelLabel, dotPanels } from "@/lib/dot-profile";
import { publicModelSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function readDefaultModel() {
  try {
    return defaultModelLabel(publicModelSettings());
  } catch {
    return defaultModelLabel(null);
  }
}

export async function GET(request: Request, context: Context) {
  try {
    requireAccess(request);
    const { id } = await context.params;
    const dot = getDotStore().get(id);
    if (!dot) throw new ChatError("没有这个 Dot", 404);
    const defaultModel = readDefaultModel();
    return Response.json(
      {
        dot,
        defaultModel,
        recent: CUSTOM_DOT_RECENT,
        tabs: dotPanels(dot, defaultModel),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const { id } = await context.params;
    getDotStore().remove(id);
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
