export const GOAL_MAX = 120;
export const WORKSPACE_MAX = 60;
export const NEXT_STEP_MAX = 200;
export const CRITERION_MAX = 200;
export const CRITERIA_LIMIT = 30;
export const RUN_LIMIT_MIN = 1;
export const RUN_LIMIT_MAX = 10000;
export const RUN_LIMIT_DEFAULT = 10;
export const GOAL_LIMIT = 200;

export const WORK_STATUSES = ["active", "needs_you", "done", "planned"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_FILTERS = [
  { id: "all", label: "全部" },
  { id: "active", label: "进行中" },
  { id: "needs_you", label: "需要你处理" },
  { id: "done", label: "已完成" },
  { id: "planned", label: "计划与例行" },
] as const;

export type WorkFilterId = (typeof WORK_FILTERS)[number]["id"];

export type WorkGoal = {
  id: string;
  goal: string;
  criteria: string[];
  workspace: string;
  nextStep: string;
  maxRuns: number;
  status: WorkStatus;
  createdAt: number;
  updatedAt: number;
};

export type WorkInput = {
  goal: string;
  criteria: string[];
  workspace: string;
  nextStep: string;
  maxRuns: number;
};

export type ParseResult =
  | { ok: true; value: WorkInput }
  | { ok: false; error: string };

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const STATUS_LABELS: Record<WorkStatus, string> = {
  active: "进行中",
  needs_you: "需要你处理",
  done: "已完成",
  planned: "计划",
};

export function isWorkStatus(value: string): value is WorkStatus {
  return (WORK_STATUSES as readonly string[]).includes(value);
}

export function isWorkId(value: string) {
  return /^goal_[a-f0-9]{16}$/.test(value);
}

export function workStatusLabel(status: WorkStatus) {
  return STATUS_LABELS[status];
}

export function matchesWorkFilter(status: WorkStatus, filter: WorkFilterId) {
  if (filter === "all") return true;
  return status === filter;
}

export function filterGoals<T extends { status: WorkStatus }>(goals: T[], filter: WorkFilterId) {
  return goals.filter((goal) => matchesWorkFilter(goal.status, filter));
}

export function workEmptyMessage(filter: WorkFilterId) {
  switch (filter) {
    case "all":
      return "还没有委托。写下目标、完成条件、工作区和下一步，创建后会留在这台机器上。";
    case "active":
      return "还没有进行中的委托。新建的目标先记为计划，还不会自动开始执行。";
    case "needs_you":
      return "目前没有需要你处理的委托。";
    case "done":
      return "还没有已完成的委托。没有执行记录之前，不会把目标标成完成。";
    case "planned":
      return "还没有计划和例行委托。写下一个目标后会出现在这里。";
  }
}

function readText(
  value: unknown,
  label: string,
  max: number,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${label}格式不正确` };
  const text = value.trim();
  if (!text) return { ok: false, error: `请填写${label}` };
  if (text.length > max) return { ok: false, error: `${label}请控制在 ${max} 个字以内` };
  if (CONTROL.test(text)) return { ok: false, error: `${label}不能包含换行或控制字符` };
  return { ok: true, value: text };
}

function readCriteria(
  value: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  let lines: unknown[];
  if (typeof value === "string") {
    lines = value.split(/\r?\n|\u2028|\u2029/);
  } else if (Array.isArray(value)) {
    lines = value;
  } else {
    return { ok: false, error: "完成条件格式不正确" };
  }
  const criteria: string[] = [];
  for (const line of lines) {
    if (typeof line !== "string") return { ok: false, error: "完成条件格式不正确" };
    const text = line.trim();
    if (!text) continue;
    if (text.length > CRITERION_MAX) {
      return { ok: false, error: `单条完成条件请控制在 ${CRITERION_MAX} 个字以内` };
    }
    if (CONTROL.test(text)) return { ok: false, error: "完成条件不能包含控制字符" };
    criteria.push(text);
  }
  if (criteria.length === 0) return { ok: false, error: "请至少写一条完成条件" };
  if (criteria.length > CRITERIA_LIMIT) {
    return { ok: false, error: `完成条件请控制在 ${CRITERIA_LIMIT} 条以内` };
  }
  return { ok: true, value: criteria };
}

function readMaxRuns(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: RUN_LIMIT_DEFAULT };
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return { ok: false, error: "最多执行次数必须是 1 到 10000 的整数" };
  }
  if (value < RUN_LIMIT_MIN || value > RUN_LIMIT_MAX) {
    return { ok: false, error: "最多执行次数必须是 1 到 10000 的整数" };
  }
  return { ok: true, value };
}

export function parseWorkInput(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "委托资料格式不正确" };
  }
  const value = input as Record<string, unknown>;
  const goal = readText(value.goal, "目标", GOAL_MAX);
  if (!goal.ok) return goal;
  const criteria = readCriteria(value.criteria);
  if (!criteria.ok) return criteria;
  const workspace = readText(value.workspace, "工作区", WORKSPACE_MAX);
  if (!workspace.ok) return workspace;
  const nextStep = readText(value.nextStep, "下一步", NEXT_STEP_MAX);
  if (!nextStep.ok) return nextStep;
  const maxRuns = readMaxRuns(value.maxRuns);
  if (!maxRuns.ok) return maxRuns;
  return {
    ok: true,
    value: {
      goal: goal.value,
      criteria: criteria.value,
      workspace: workspace.value,
      nextStep: nextStep.value,
      maxRuns: maxRuns.value,
    },
  };
}
