import { describe, expect, it } from "vitest";
import {
  CRITERIA_LIMIT,
  CRITERION_MAX,
  GOAL_MAX,
  RUN_LIMIT_DEFAULT,
  RUN_LIMIT_MAX,
  WORK_FILTERS,
  filterGoals,
  parseWorkInput,
  workEmptyMessage,
  workStatusLabel,
  type WorkStatus,
} from "./work-profile";

const valid = {
  goal: "整理本周会议纪要",
  criteria: ["纪要已写好", "已发给相关的人"],
  workspace: "个人",
  nextStep: "先列出要整理的会议",
};

describe("work goal input", () => {
  it("trims fields, splits criteria, and defaults the run limit to 10", () => {
    expect(
      parseWorkInput({
        goal: "  整理本周会议纪要  ",
        criteria: " 纪要已写好 \n\n 已发给相关的人 \r\n",
        workspace: " 个人 ",
        nextStep: " 先列出要整理的会议 ",
      }),
    ).toEqual({
      ok: true,
      value: { ...valid, maxRuns: RUN_LIMIT_DEFAULT },
    });
    expect(parseWorkInput({ ...valid, criteria: [" 一条 ", "", " 另一条 "] })).toMatchObject({
      ok: true,
      value: { criteria: ["一条", "另一条"], maxRuns: 10 },
    });
    expect(parseWorkInput({ ...valid, maxRuns: null })).toMatchObject({
      ok: true,
      value: { maxRuns: 10 },
    });
    expect(parseWorkInput({ ...valid, maxRuns: "" })).toMatchObject({
      ok: true,
      value: { maxRuns: 10 },
    });
  });

  it("accepts the run limits 1 and 10000 and rejects anything outside", () => {
    expect(parseWorkInput({ ...valid, maxRuns: 1 })).toMatchObject({ ok: true, value: { maxRuns: 1 } });
    expect(parseWorkInput({ ...valid, maxRuns: RUN_LIMIT_MAX })).toMatchObject({
      ok: true,
      value: { maxRuns: 10000 },
    });
    for (const maxRuns of [0, -1, 10001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", true]) {
      const parsed = parseWorkInput({ ...valid, maxRuns });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("1 到 10000");
    }
  });

  it("rejects empty, oversized, and unsafe goal fields", () => {
    expect(parseWorkInput({ ...valid, goal: "   " }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, goal: "目".repeat(GOAL_MAX + 1) }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, goal: "目".repeat(GOAL_MAX) }).ok).toBe(true);
    expect(parseWorkInput({ ...valid, goal: "第一行\n第二行" }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, workspace: "" }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, nextStep: "下一\t步" }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, criteria: "完成\u0007报告" }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, criteria: "\n\n" }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, criteria: ["完成", 1] }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, criteria: 3 }).ok).toBe(false);
    expect(parseWorkInput({ ...valid, criteria: "条".repeat(CRITERION_MAX + 1) }).ok).toBe(false);
    expect(
      parseWorkInput({
        ...valid,
        criteria: Array.from({ length: CRITERIA_LIMIT + 1 }, (_, index) => `条件${index}`),
      }).ok,
    ).toBe(false);
    expect(parseWorkInput(null).ok).toBe(false);
    expect(parseWorkInput(["不是对象"]).ok).toBe(false);
  });
});

describe("work filters", () => {
  const goals: { status: WorkStatus }[] = [
    { status: "planned" },
    { status: "active" },
    { status: "needs_you" },
    { status: "done" },
  ];

  it("uses the five work tabs and keeps new plans out of the other buckets", () => {
    expect(WORK_FILTERS.map((item) => item.label)).toEqual([
      "全部",
      "进行中",
      "需要你处理",
      "已完成",
      "计划与例行",
    ]);
    expect(filterGoals(goals, "all")).toHaveLength(4);
    expect(filterGoals(goals, "planned").map((goal) => goal.status)).toEqual(["planned"]);
    expect(filterGoals(goals, "active").map((goal) => goal.status)).toEqual(["active"]);
    expect(filterGoals(goals, "needs_you").map((goal) => goal.status)).toEqual(["needs_you"]);
    expect(filterGoals(goals, "done").map((goal) => goal.status)).toEqual(["done"]);
    expect(workStatusLabel("planned")).toBe("计划");
    for (const item of WORK_FILTERS) {
      const message = workEmptyMessage(item.id);
      expect(message.length).toBeGreaterThan(8);
      expect(message).not.toMatch(/第 \d+ 天/);
    }
  });
});
