export const TITLE_MAX = 80;
export const BODY_MAX = 2000;
export const WORKSPACE_MAX = 60;
export const QUERY_MAX = 80;
export const MEMORY_LIMIT = 300;
export const VERSION_LIMIT = 40;

export const MEMORY_KINDS = [
  { id: "fact", label: "事实" },
  { id: "decision", label: "决策" },
  { id: "experience", label: "经验" },
  { id: "follow_up", label: "待跟进" },
] as const;

export const MEMORY_SCOPES = [
  { id: "workspace", label: "工作区记忆" },
  { id: "personal", label: "个人记忆" },
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number]["id"];
export type MemoryScope = (typeof MEMORY_SCOPES)[number]["id"];

export type MemoryContent = {
  kind: MemoryKind;
  title: string;
  body: string;
};

export type MemoryDraft = MemoryContent & {
  scope: MemoryScope;
  workspace: string;
};

export type MemoryItem = MemoryDraft & {
  id: string;
  version: number;
  crossWorkspace: boolean;
  createdAt: number;
  updatedAt: number;
};

export type MemoryVersion = MemoryContent & {
  version: number;
  createdAt: number;
};

export type MemoryListQuery = {
  q: string;
  kind: MemoryKind | "";
  scope: MemoryScope | "";
  forWorkspace: string;
};

export type MemoryAction =
  | { action: "create"; draft: MemoryDraft }
  | { action: "revise"; id: string; content: MemoryContent }
  | { action: "forget"; id: string }
  | { action: "authorize"; id: string; crossWorkspace: boolean }
  | { action: "mem0"; enabled: boolean };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const BODY_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/;

const KIND_LABELS: Record<MemoryKind, string> = {
  fact: "事实",
  decision: "决策",
  experience: "经验",
  follow_up: "待跟进",
};

export function isMemoryKind(value: string): value is MemoryKind {
  return MEMORY_KINDS.some((kind) => kind.id === value);
}

export function isMemoryScope(value: string): value is MemoryScope {
  return MEMORY_SCOPES.some((scope) => scope.id === value);
}

export function isMemoryId(value: string) {
  return /^mem_[a-f0-9]{16}$/.test(value);
}

export function memoryKindLabel(kind: MemoryKind) {
  return KIND_LABELS[kind];
}

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function readLine(value: unknown, label: string, max: number): ParseResult<string> {
  if (typeof value !== "string") return fail(`${label}格式不正确`);
  const text = value.trim();
  if (!text) return fail(`请填写${label}`);
  if (text.length > max) return fail(`${label}请控制在 ${max} 个字以内`);
  if (CONTROL.test(text)) return fail(`${label}不能包含换行或控制字符`);
  return { ok: true, value: text };
}

function readBody(value: unknown): ParseResult<string> {
  if (typeof value !== "string") return fail("内容格式不正确");
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!text) return fail("请填写内容");
  if (text.length > BODY_MAX) return fail(`内容请控制在 ${BODY_MAX} 个字以内`);
  if (BODY_CONTROL.test(text)) return fail("内容不能包含控制字符");
  return { ok: true, value: text };
}

function readKind(value: unknown): ParseResult<MemoryKind> {
  if (typeof value !== "string" || !isMemoryKind(value)) return fail("请选择事实、决策、经验或待跟进");
  return { ok: true, value };
}

function readContent(value: Record<string, unknown>): ParseResult<MemoryContent> {
  const kind = readKind(value.kind);
  if (!kind.ok) return kind;
  const title = readLine(value.title, "标题", TITLE_MAX);
  if (!title.ok) return title;
  const body = readBody(value.body);
  if (!body.ok) return body;
  return { ok: true, value: { kind: kind.value, title: title.value, body: body.value } };
}

function readWorkspace(scope: MemoryScope, value: unknown): ParseResult<string> {
  if (scope === "personal") {
    if (value === undefined || value === null) return { ok: true, value: "" };
    if (typeof value !== "string") return fail("个人记忆不绑定某一个工作区");
    if (value.trim()) return fail("个人记忆不绑定某一个工作区");
    return { ok: true, value: "" };
  }
  return readLine(value, "工作区", WORKSPACE_MAX);
}

function readId(value: unknown): ParseResult<string> {
  if (typeof value !== "string" || !isMemoryId(value)) return fail("找不到这条记忆");
  return { ok: true, value };
}

function rejectMemoryMove(value: Record<string, unknown>): ParseResult<true> {
  if ("scope" in value || "workspace" in value || "crossWorkspace" in value) {
    return fail("编辑只会生成新版本，不能改工作区或授权");
  }
  return { ok: true, value: true };
}

export function parseMemoryDraft(input: unknown): ParseResult<MemoryDraft> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("记忆格式不正确");
  const value = input as Record<string, unknown>;
  if ("crossWorkspace" in value) return fail("请创建后再逐条授权跨工作区使用");
  const content = readContent(value);
  if (!content.ok) return content;
  if (typeof value.scope !== "string" || !isMemoryScope(value.scope)) {
    return fail("请选择工作区记忆或个人记忆");
  }
  const workspace = readWorkspace(value.scope, value.workspace);
  if (!workspace.ok) return workspace;
  return {
    ok: true,
    value: { ...content.value, scope: value.scope, workspace: workspace.value },
  };
}

export function parseMemoryListQuery(params: URLSearchParams): ParseResult<MemoryListQuery> {
  const rawQuery = params.get("q") ?? "";
  if (typeof rawQuery !== "string") return fail("搜索格式不正确");
  const q = rawQuery.trim();
  if (q.length > QUERY_MAX) return fail(`搜索请控制在 ${QUERY_MAX} 个字以内`);
  if (CONTROL.test(q)) return fail("搜索不能包含换行或控制字符");
  const rawKind = params.get("kind") ?? "";
  let kind: MemoryKind | "" = "";
  if (rawKind) {
    if (!isMemoryKind(rawKind)) return fail("请选择事实、决策、经验或待跟进");
    kind = rawKind;
  }
  const rawScope = params.get("scope") ?? "";
  let scope: MemoryScope | "" = "";
  if (rawScope) {
    if (!isMemoryScope(rawScope)) return fail("请选择工作区记忆或个人记忆");
    scope = rawScope;
  }
  const rawWorkspace = params.get("forWorkspace") ?? "";
  const forWorkspace = rawWorkspace.trim();
  if (forWorkspace.length > WORKSPACE_MAX) return fail(`工作区请控制在 ${WORKSPACE_MAX} 个字以内`);
  if (CONTROL.test(forWorkspace)) return fail("工作区不能包含换行或控制字符");
  const id = params.get("id");
  if (id !== null && !isMemoryId(id)) return fail("找不到这条记忆");
  return { ok: true, value: { q, kind, scope, forWorkspace } };
}

export function parseMemoryAction(input: unknown): ParseResult<MemoryAction> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("记忆格式不正确");
  const value = input as Record<string, unknown>;
  switch (value.action) {
    case "create": {
      const draft = parseMemoryDraft(value);
      if (!draft.ok) return draft;
      return { ok: true, value: { action: "create", draft: draft.value } };
    }
    case "revise": {
      const id = readId(value.id);
      if (!id.ok) return id;
      const moved = rejectMemoryMove(value);
      if (!moved.ok) return moved;
      const content = readContent(value);
      if (!content.ok) return content;
      return { ok: true, value: { action: "revise", id: id.value, content: content.value } };
    }
    case "forget": {
      const id = readId(value.id);
      if (!id.ok) return id;
      return { ok: true, value: { action: "forget", id: id.value } };
    }
    case "authorize": {
      const id = readId(value.id);
      if (!id.ok) return id;
      if (typeof value.crossWorkspace !== "boolean") return fail("请明确是否允许跨工作区使用");
      return {
        ok: true,
        value: { action: "authorize", id: id.value, crossWorkspace: value.crossWorkspace },
      };
    }
    case "mem0": {
      if (typeof value.enabled !== "boolean") return fail("请明确 Mem0 开关");
      return { ok: true, value: { action: "mem0", enabled: value.enabled } };
    }
    default:
      return fail("请说明要做的操作");
  }
}
