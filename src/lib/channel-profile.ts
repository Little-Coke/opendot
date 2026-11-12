export const CHANNELS = [
  {
    id: "feishu",
    name: "飞书",
    fields: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App Secret" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    fields: [{ key: "botToken", label: "Bot Token" }],
  },
  {
    id: "qq",
    name: "QQ",
    fields: [
      { key: "appId", label: "App ID" },
      { key: "token", label: "Token" },
    ],
  },
  {
    id: "wechat",
    name: "微信",
    fields: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App Secret" },
    ],
  },
  {
    id: "dingtalk",
    name: "钉钉",
    fields: [
      { key: "appKey", label: "App Key" },
      { key: "appSecret", label: "App Secret" },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    fields: [{ key: "botToken", label: "Bot Token" }],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    fields: [
      { key: "phoneNumberId", label: "电话号码 ID" },
      { key: "accessToken", label: "Access Token" },
    ],
  },
] as const;

export type ChannelId = (typeof CHANNELS)[number]["id"];
export type ChannelFieldKey = (typeof CHANNELS)[number]["fields"][number]["key"];

export const GROUP_REPLIES = [
  { id: "mention", label: "仅在 @机器人 时回复" },
  { id: "all", label: "全部回复" },
] as const;

export type GroupReply = (typeof GROUP_REPLIES)[number]["id"];

export const PAIR_TTL_MS = 10 * 60 * 1000;
const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type PublicCredential = {
  key: string;
  label: string;
  configured: boolean;
};

export type PublicChannel = {
  id: ChannelId;
  name: string;
  enabled: boolean;
  paired: boolean;
  credentials: PublicCredential[];
};

export type ChannelSnapshot = {
  groupReply: GroupReply;
  channels: PublicChannel[];
};

export function isChannelId(value: unknown): value is ChannelId {
  return CHANNELS.some((channel) => channel.id === value);
}

export function channelSpec(id: ChannelId) {
  const spec = CHANNELS.find((channel) => channel.id === id);
  if (!spec) throw new Error("未知渠道");
  return spec;
}

export function isGroupReply(value: unknown): value is GroupReply {
  return value === "mention" || value === "all";
}

export function groupReplyLabel(value: GroupReply) {
  return GROUP_REPLIES.find((item) => item.id === value)?.label ?? "仅在 @机器人 时回复";
}

export function normalizePairCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  if (code.length !== 8) return undefined;
  if ([...code].some((char) => !PAIR_ALPHABET.includes(char))) return undefined;
  return code;
}

export function parsePairCommand(value: unknown):
  | { ok: true; code: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "配对码不正确，已拒绝" };
  const match = value.trim().match(/^\/pair\s+(\S+)$/);
  if (!match) return { ok: false, error: "配对码不正确，已拒绝" };
  const code = normalizePairCode(match[1]);
  if (!code) return { ok: false, error: "配对码不正确，已拒绝" };
  return { ok: true, code };
}

export function isTelegramToken(value: string) {
  return /^\d{6,16}:[A-Za-z0-9_-]{20,80}$/.test(value);
}
