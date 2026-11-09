import { describe, expect, it } from "vitest";
import { healthPayload } from "@/lib/health";
import { MOBILE_NAV, SIDE_LINKS, isActive } from "@/lib/nav";

describe("day 1 shell", () => {
  it("exposes the four mobile tabs from the spec", () => {
    expect(MOBILE_NAV.map((item) => item.label)).toEqual(["小点", "团队", "工作", "设置"]);
  });

  it("keeps work and inbox on the desktop sidebar", () => {
    expect(SIDE_LINKS.map((item) => item.label)).toEqual(["我的工作", "需要你处理", "设置"]);
  });

  it("treats a chat route as the 小点 tab", () => {
    expect(isActive("/", "/c/xiaodian")).toBe(true);
    expect(isActive("/team", "/c/xiaodian")).toBe(false);
    expect(isActive("/work", "/inbox")).toBe(false);
    expect(isActive("/work", "/inbox", true)).toBe(true);
    expect(isActive("/settings", "/settings")).toBe(true);
  });

  it("reports a healthy app", () => {
    expect(healthPayload()).toEqual({ ok: true, app: "opendot" });
  });
});
