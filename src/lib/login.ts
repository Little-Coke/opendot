import { matchesPassword } from "./auth";
import { ChatError } from "./chat-store";

let windowStart = 0;
let failures = 0;
export function verifyLogin(password: string) {
  // A shared public endpoint must never let anonymous failures lock out its owner.
  if (matchesPassword(password)) return;
  if (Date.now() - windowStart > 60_000) {
    windowStart = Date.now();
    failures = 0;
  }
  failures++;
  if (failures > 10)
    throw new ChatError("登录失败次数较多，请检查密码后重试", 429);
  throw new ChatError("访问密码不正确", 401);
}
