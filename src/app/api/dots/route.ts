import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { getDotStore } from "@/lib/dots";
import { CUSTOM_DOT_RECENT, defaultModelLabel } from "@/lib/dot-profile";
import { publicModelSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readDefaultModel() {
  try {
    return defaultModelLabel(publicModelSettings());
  } catch {
    return defaultModelLabel(null);
  }
}

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(
      {
        defaultModel: readDefaultModel(),
        recent: CUSTOM_DOT_RECENT,
        dots: getDotStore().list(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const dot = getDotStore().create(await readJson(request));
    return Response.json(dot, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
