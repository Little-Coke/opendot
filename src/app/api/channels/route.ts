import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { readChannels, saveChannel } from "@/lib/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(readChannels(), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    return Response.json(saveChannel(await readJson(request)), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
