import { errorResponse, readJson, requireAccess, requireSameOrigin } from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
import { assertWaitAssignment, readDevices, setDeviceStatus, setNodesEnabled } from "@/lib/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    requireAccess(request);
    return Response.json(readDevices(), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    requireAccess(request);
    requireSameOrigin(request);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ChatError("设备设置格式不正确");
    }
    const value = body as Record<string, unknown>;
    assertWaitAssignment(value.assignment);
    const hasSwitch = value.nodesEnabled !== undefined;
    const hasStatus = value.id !== undefined || value.status !== undefined;
    if (!hasSwitch && !hasStatus) throw new ChatError("没有要保存的内容");
    if (hasSwitch) setNodesEnabled(value.nodesEnabled);
    if (hasStatus) setDeviceStatus(value.id, value.status);
    return Response.json(readDevices(), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
