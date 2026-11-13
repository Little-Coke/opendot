export const DOT_SHAPES = ["circle", "rounded", "square", "diamond", "hexagon"] as const;
export type DotShape = (typeof DOT_SHAPES)[number];

export const SHAPE_LABELS: Record<DotShape, string> = {
  circle: "圆形",
  rounded: "圆角",
  square: "方形",
  diamond: "菱形",
  hexagon: "六边形",
};

export const DOT_COLORS = [
  { value: "#3ecf8e", label: "绿色" },
  { value: "#3b82f6", label: "蓝色" },
  { value: "#f59e0b", label: "琥珀" },
  { value: "#ef4444", label: "红色" },
  { value: "#8b5cf6", label: "紫色" },
  { value: "#ec4899", label: "粉色" },
  { value: "#14b8a6", label: "青色" },
  { value: "#64748b", label: "灰色" },
] as const;

export type DotColor = (typeof DOT_COLORS)[number]["value"];

export const DOT_NAME_MAX = 24;
export const DOT_ROLE_MAX = 200;
export const DOT_LIMIT = 24;
export const MAIN_DOT_ID = "xiaodian";
export const CUSTOM_DOT_RECENT = "还没有独立对话";

export const DOT_TABS = [
  { id: "chat", label: "对话" },
  { id: "work", label: "当前工作" },
  { id: "skills", label: "能力" },
  { id: "memory", label: "记忆" },
  { id: "settings", label: "设置" },
] as const;

export type DotTabId = (typeof DOT_TABS)[number]["id"];

export type CustomDot = {
  id: string;
  name: string;
  shape: DotShape;
  color: string;
  role: string;
  createdAt: number;
  updatedAt: number;
};

export type DotInput = {
  name: string;
  shape: DotShape;
  color: DotColor;
  role: string;
};

export type DotPanel = {
  id: DotTabId;
  label: string;
  body: string;
};

export type ParseResult =
  | { ok: true; value: DotInput }
  | { ok: false; error: string };

const CONTROL = /[\u0000-\u001f\u007f]/;

export function isDotShape(value: string): value is DotShape {
  return (DOT_SHAPES as readonly string[]).includes(value);
}

export function isDotColor(value: string): value is DotColor {
  return DOT_COLORS.some((item) => item.value === value);
}

export function isCustomDotId(value: string) {
  return /^dot_[a-f0-9]{16}$/.test(value);
}

export function shapeLabel(shape: string) {
  return isDotShape(shape) ? SHAPE_LABELS[shape] : "未知形状";
}

export function colorLabel(color: string) {
  return DOT_COLORS.find((item) => item.value === color)?.label ?? "未知颜色";
}

export function roleLabel(role: string) {
  const text = role.trim();
  return text || "未填写角色说明";
}

export function defaultModelLabel(
  settings: { model: string; hasKey: boolean } | null,
) {
  const model = settings?.model.trim() ?? "";
  if (!settings?.hasKey || !model) return "默认模型 · 演示模式";
  return `默认模型 · ${model}`;
}

function readText(
  value: unknown,
  label: string,
  max: number,
  required: boolean,
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return required
      ? { ok: false, error: `请填写${label}` }
      : { ok: true, value: "" };
  }
  if (typeof value !== "string") return { ok: false, error: `${label}格式不正确` };
  const text = value.trim();
  if (!text) {
    return required
      ? { ok: false, error: `请填写${label}` }
      : { ok: true, value: "" };
  }
  if (text.length > max) return { ok: false, error: `${label}请控制在 ${max} 个字以内` };
  if (CONTROL.test(text)) return { ok: false, error: `${label}不能包含换行或控制字符` };
  return { ok: true, value: text };
}

export function parseDotInput(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Dot 资料格式不正确" };
  }
  const value = input as Record<string, unknown>;
  const name = readText(value.name, "名字", DOT_NAME_MAX, true);
  if (!name.ok) return name;
  if (name.value === "小点") return { ok: false, error: "小点是主 Dot，请换一个名字" };
  if (typeof value.shape !== "string" || !isDotShape(value.shape)) {
    return { ok: false, error: "请选择圆形、圆角、方形、菱形或六边形" };
  }
  if (typeof value.color !== "string" || !isDotColor(value.color)) {
    return { ok: false, error: "请选择列出的颜色" };
  }
  const role = readText(value.role, "角色说明", DOT_ROLE_MAX, false);
  if (!role.ok) return role;
  return {
    ok: true,
    value: { name: name.value, shape: value.shape, color: value.color, role: role.value },
  };
}

export function dotPanels(
  dot: Pick<CustomDot, "name" | "shape" | "color" | "role">,
  modelLabel: string,
): DotPanel[] {
  return [
    {
      id: "chat",
      label: "对话",
      body: `${dot.name}还没有自己的会话。每个 Dot 的独立会话以后会分开；在那之前，对话仍在小点里进行。`,
    },
    {
      id: "work",
      label: "当前工作",
      body: `${dot.name}当前没有进行中的委托。目标、完成条件和执行记录以后出现在「我的工作」，这一页先说明进度从哪里看。`,
    },
    {
      id: "skills",
      label: "能力",
      body: `技能和外部连接还没有接到${dot.name}。以后能力库只登记 MCP 和技能，不会在这里拉起宿主机进程，首次启用也需要你同意。`,
    },
    {
      id: "memory",
      label: "记忆",
      body: "工作区记忆在设置页，分成事实、决策、经验和待跟进。可以新建、搜索和查看版本。忘记一条记忆不会删除聊天记录。个人记忆要跨工作区使用，需要逐条授权。Mem0 默认关闭，没有接入外部服务。",
    },
    {
      id: "settings",
      label: "设置",
      body: `名字是「${dot.name}」，形状是${shapeLabel(dot.shape)}，颜色是${colorLabel(dot.color)}。角色说明：${roleLabel(dot.role)}。模型跟随小点，当前为${modelLabel}。这些资料写在数据卷的独立数据库里，重新部署不会丢失。要更换名字、形状、颜色或角色，删除这个 Dot 后重新创建。`,
    },
  ];
}
