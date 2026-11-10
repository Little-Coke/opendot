import { describe, expect, it } from "vitest";
import {
  CUSTOM_DOT_RECENT,
  DOT_COLORS,
  DOT_NAME_MAX,
  DOT_ROLE_MAX,
  DOT_TABS,
  defaultModelLabel,
  dotPanels,
  isCustomDotId,
  parseDotInput,
  roleLabel,
} from "./dot-profile";

const valid = {
  name: "资料员",
  shape: "hexagon",
  color: DOT_COLORS[4].value,
  role: "整理每周资料",
};

describe("custom dot profile", () => {
  it("accepts a trimmed dot and keeps the role optional", () => {
    expect(parseDotInput({ ...valid, name: "  资料员  ", role: "  " })).toEqual({
      ok: true,
      value: { ...valid, role: "" },
    });
    expect(parseDotInput({ name: "助手", shape: "circle", color: "#3b82f6" })).toMatchObject({
      ok: true,
      value: { role: "" },
    });
  });

  it("rejects reserved, empty, oversized, and unsafe fields", () => {
    expect(parseDotInput({ ...valid, name: "小点" }).ok).toBe(false);
    expect(parseDotInput({ ...valid, name: "   " }).ok).toBe(false);
    expect(parseDotInput({ ...valid, name: "名".repeat(DOT_NAME_MAX + 1) }).ok).toBe(false);
    expect(parseDotInput({ ...valid, name: "名".repeat(DOT_NAME_MAX) }).ok).toBe(true);
    expect(parseDotInput({ ...valid, shape: "star" }).ok).toBe(false);
    expect(parseDotInput({ ...valid, color: "#ffffff" }).ok).toBe(false);
    expect(parseDotInput({ ...valid, role: "甲".repeat(DOT_ROLE_MAX + 1) }).ok).toBe(false);
    expect(parseDotInput({ ...valid, role: "第一行\n第二行" }).ok).toBe(false);
    expect(parseDotInput(null).ok).toBe(false);
    expect(isCustomDotId("xiaodian")).toBe(false);
    expect(isCustomDotId(`dot_${"a".repeat(16)}`)).toBe(true);
  });

  it("describes five tabs and leaves the last three as explanations", () => {
    const panels = dotPanels(
      { name: "资料员", shape: "diamond", color: "#f59e0b", role: "" },
      defaultModelLabel({ model: "unit-model", hasKey: true }),
    );
    expect(panels.map((panel) => panel.label)).toEqual(DOT_TABS.map((tab) => tab.label));
    expect(panels.map((panel) => panel.label)).toEqual([
      "对话",
      "当前工作",
      "能力",
      "记忆",
      "设置",
    ]);
    expect(panels.every((panel) => panel.body.length > 20)).toBe(true);
    expect(panels[0].body).toContain("小点");
    expect(panels[2].body).toContain("不会在这里拉起宿主机进程");
    expect(panels[3].body).toContain("不会删除聊天记录");
    expect(panels[4].body).toContain("菱形");
    expect(panels[4].body).toContain("琥珀");
    expect(panels[4].body).toContain("未填写角色说明");
    expect(panels[4].body).toContain("默认模型 · unit-model");
    expect(roleLabel("")).toBe("未填写角色说明");
    expect(defaultModelLabel(null)).toBe("默认模型 · 演示模式");
    expect(CUSTOM_DOT_RECENT).toBe("还没有独立对话");
  });
});
