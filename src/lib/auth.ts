import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ChatError } from "./chat-store";

export function passwordConfigured() {
  return !!process.env.OPENDOT_PASSWORD;
}
function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
export function matchesPassword(value: string) {
  return (
    passwordConfigured() &&
    timingSafeEqual(digest(value), digest(process.env.OPENDOT_PASSWORD || ""))
  );
}
function signature(payload: string) {
  return createHmac("sha256", digest(process.env.OPENDOT_PASSWORD || ""))
    .update(`opendot-session:${payload}`)
    .digest("hex");
}
export function createSession() {
  const payload = `${Date.now() + 7 * 86400000}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${signature(payload)}`;
}
export function isAuthenticated(request: Request) {
  if (!passwordConfigured()) return process.env.NODE_ENV !== "production";
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("opendot_session="))
    ?.slice("opendot_session=".length);
  if (!token) return false;
  const [expiry, nonce, mac, ...rest] = token.split(".");
  if (
    rest.length ||
    !/^\d+$/.test(expiry) ||
    !/^[a-f0-9]{32}$/.test(nonce || "") ||
    !/^[a-f0-9]{64}$/.test(mac || "")
  )
    return false;
  if (Number(expiry) <= Date.now()) return false;
  return timingSafeEqual(
    Buffer.from(mac, "hex"),
    Buffer.from(signature(`${expiry}.${nonce}`), "hex"),
  );
}
export function requireAccess(request: Request) {
  if (!passwordConfigured() && process.env.NODE_ENV === "production")
    throw new ChatError("请先在服务器配置 OPENDOT_PASSWORD，然后重新部署", 503);
  if (!isAuthenticated(request)) throw new ChatError("请先登录 OpenDot", 401);
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  if (!origin) throw new ChatError("缺少请求来源", 403);
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ChatError("请求来源无效", 403);
  }
  if (url.host !== host || !["https:", "http:"].includes(url.protocol))
    throw new ChatError("请求来源不匹配", 403);
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ChatError("请发送 JSON 请求", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError("请求内容为空");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new ChatError("请求内容过大", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      throw new ChatError("JSON 格式不正确");
    }
  } finally {
    reader.releaseLock();
  }
}
export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ChatError
          ? error.message
          : "服务暂时不可用，请稍后重试",
    },
    {
      status: error instanceof ChatError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
