import {
  errorResponse,
  readJson,
  requireAccess,
  requireSameOrigin,
} from "@/lib/auth";
import { publicModelSettings, saveModelConfig } from "@/lib/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(publicModelSettings(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PUT(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    saveModelConfig(await readJson(request));
    return Response.json(publicModelSettings(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
