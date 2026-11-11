import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { getWorkStore } from "@/lib/work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(
      { goals: getWorkStore().list() },
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
    const goal = getWorkStore().create(await readJson(request));
    return Response.json(goal, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
