import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { changeMemory, viewMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(viewMemory(new URL(request.url)), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const result = changeMemory(await readJson(request));
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
