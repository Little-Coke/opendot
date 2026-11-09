import { verifyLogin } from "@/lib/login";
import {
  createSession,
  errorResponse,
  isAuthenticated,
  passwordConfigured,
  readJson,
  requireSameOrigin,
} from "@/lib/auth";
import { ChatError } from "@/lib/chat-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return Response.json(
    {
      authenticated: isAuthenticated(request),
      configured: passwordConfigured(),
      setupRequired:
        !passwordConfigured() && process.env.NODE_ENV === "production",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await readJson(request);
    if (
      !input ||
      typeof input.password !== "string" ||
      input.password.length > 1024
    )
      throw new ChatError("请输入访问密码");
    verifyLogin(input.password);
    return Response.json(
      { authenticated: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `opendot_session=${createSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    return Response.json(
      { authenticated: false },
      {
        headers: {
          "Set-Cookie":
            "opendot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
