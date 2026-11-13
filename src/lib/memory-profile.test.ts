import { describe, expect, it } from "vitest";
import {
  BODY_MAX,
  TITLE_MAX,
  isMemoryId,
  isMemoryKind,
  parseMemoryAction,
  parseMemoryDraft,
  parseMemoryListQuery,
} from "./memory-profile";

const draft = {
  kind: "fact",
  scope: "workspace",
  workspace: " 产品 ",
  title: " 周五例会 ",
  body: " 改到下午三点\r\n地点不变 ",
};

describe("memory profile", () => {
  it("accepts the four kinds and both scopes", () => {
    expect(parseMemoryDraft(draft)).toEqual({
      ok: true,
      value: {
        kind: "fact",
        scope: "workspace",
        workspace: "产品",
        title: "周五例会",
        body: "改到下午三点\n地点不变",
      },
    });
    expect(parseMemoryDraft({ ...draft, scope: "personal", workspace: "  " })).toMatchObject({
      ok: true,
      value: { scope: "personal", workspace: "" },
    });
    for (const kind of ["fact", "decision", "experience", "follow_up"]) {
      expect(isMemoryKind(kind)).toBe(true);
      expect(parseMemoryDraft({ ...draft, kind }).ok).toBe(true);
    }
    expect(isMemoryId("mem_" + "a".repeat(16))).toBe(true);
    expect(isMemoryId("goal_" + "a".repeat(16))).toBe(false);
  });

  it("rejects malformed drafts and early cross-workspace authorization", () => {
    expect(parseMemoryDraft(null).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, kind: "note" }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, scope: "global" }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, workspace: "" }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, scope: "personal", workspace: "产品" }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, title: "" }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, title: "甲".repeat(TITLE_MAX + 1) }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, body: "乙".repeat(BODY_MAX + 1) }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, title: "第一行\n第二行" }).ok).toBe(false);
    expect(parseMemoryDraft({ ...draft, crossWorkspace: true })).toEqual({
      ok: false,
      error: "请创建后再逐条授权跨工作区使用",
    });
  });

  it("parses search and keeps authorization separate from a new version", () => {
    const params = new URLSearchParams("q=%20例会%20&kind=decision&scope=personal&forWorkspace=%20产品%20");
    expect(parseMemoryListQuery(params)).toEqual({
      ok: true,
      value: { q: "例会", kind: "decision", scope: "personal", forWorkspace: "产品" },
    });
    expect(parseMemoryListQuery(new URLSearchParams("kind=other")).ok).toBe(false);
    expect(parseMemoryListQuery(new URLSearchParams("id=nope")).ok).toBe(false);
    const id = "mem_" + "b".repeat(16);
    expect(parseMemoryAction({ action: "revise", id, kind: "experience", title: "新标题", body: "新内容" })).toMatchObject({
      ok: true,
      value: { action: "revise", id },
    });
    expect(parseMemoryAction({ action: "revise", id, scope: "personal", kind: "fact", title: "标题", body: "内容" }).ok).toBe(
      false,
    );
    expect(parseMemoryAction({ action: "authorize", id, crossWorkspace: "yes" }).ok).toBe(false);
    expect(parseMemoryAction({ action: "authorize", id, crossWorkspace: true })).toMatchObject({
      ok: true,
      value: { crossWorkspace: true },
    });
    expect(parseMemoryAction({ action: "mem0", enabled: true })).toEqual({
      ok: true,
      value: { action: "mem0", enabled: true },
    });
    expect(parseMemoryAction({ action: "mem0", enabled: 1 }).ok).toBe(false);
    expect(parseMemoryAction({ action: "unknown" }).ok).toBe(false);
  });
});
