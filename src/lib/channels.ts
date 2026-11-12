import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { ChatError } from "./chat-store";
import {
  CHANNELS,
  PAIR_TTL_MS,
  channelSpec,
  isChannelId,
  isGroupReply,
  isTelegramToken,
  parsePairCommand,
  type ChannelId,
  type ChannelSnapshot,
  type GroupReply,
  type PublicChannel,
} from "./channel-profile";
import { openJson, sealJson } from "./credential-box";

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type ChannelRow = {
  id: string;
  enabled: number;
  secret: string;
  pairedAt: number | null;
};

function randomCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += PAIR_ALPHABET[byte % PAIR_ALPHABET.length];
  return code;
}

function readCredentials(directory: string, secret: string) {
  if (!secret) return {} as Record<string, string>;
  const value = openJson(directory, secret);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const credentials: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim()) credentials[key] = item;
  }
  return credentials;
}

function mergeCredentials(
  existing: Record<string, string>,
  input: unknown,
  allowed: readonly string[],
  clear: boolean,
) {
  if (clear) return {};
  if (input === undefined) return existing;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ChatError("凭据格式不正确");
  }
  const next = { ...existing };
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new ChatError("包含无法识别的凭据字段");
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.length > 4096 || /[\r\n]/.test(value)) {
      throw new ChatError("凭据格式不正确");
    }
    const text = value.trim();
    if (!text) continue;
    next[key] = text;
  }
  return next;
}

function rollback(db: DatabaseSync) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // 事务可能尚未开始。
  }
}

/** 渠道与设备存在数据卷的 channels.sqlite，不写入聊天库、dots.sqlite 或 work.sqlite。 */
export class ChannelStore {
  readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = join(directory, "channels.sqlite");
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    const channelValues = CHANNELS.map((channel) => `('${channel.id}', 0, '', NULL, 0)`).join(",\n");
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS channel_prefs (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        group_reply TEXT NOT NULL CHECK(group_reply IN ('mention', 'all'))
      );
      INSERT OR IGNORE INTO channel_prefs(id, group_reply) VALUES (1, 'mention');
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        secret TEXT NOT NULL DEFAULT '',
        paired_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO channels(id, enabled, secret, paired_at, updated_at) VALUES
        ${channelValues};
      CREATE TABLE IF NOT EXISTS pair_codes (
        code TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS device_prefs (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        nodes_enabled INTEGER NOT NULL DEFAULT 0 CHECK(nodes_enabled IN (0, 1))
      );
      INSERT OR IGNORE INTO device_prefs(id, nodes_enabled) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS device_codes (
        code TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
        assignment TEXT NOT NULL DEFAULT 'wait' CHECK(assignment = 'wait'),
        paired_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        chmodSync(`${databasePath}${suffix}`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

let singleton: ChannelStore | undefined;

export function getChannelStore() {
  const directory = process.env.DATA_DIR || join(process.cwd(), "data");
  if (!singleton || singleton.directory !== directory) {
    singleton?.db.close();
    singleton = new ChannelStore(directory);
  }
  return singleton;
}

export function closeChannelStore() {
  singleton?.db.close();
  singleton = undefined;
}

export function readChannels(store = getChannelStore()): ChannelSnapshot {
  const prefs = store.db
    .prepare("SELECT group_reply AS groupReply FROM channel_prefs WHERE id = 1")
    .get() as { groupReply: string } | undefined;
  const rows = store.db
    .prepare(
      "SELECT id, enabled, secret, paired_at AS pairedAt FROM channels",
    )
    .all() as ChannelRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const groupReply: GroupReply = isGroupReply(prefs?.groupReply) ? prefs.groupReply : "mention";
  const channels: PublicChannel[] = CHANNELS.map((spec) => {
    const row = byId.get(spec.id);
    const saved = row ? readCredentials(store.directory, row.secret) : {};
    return {
      id: spec.id,
      name: spec.name,
      enabled: row?.enabled === 1,
      paired: typeof row?.pairedAt === "number",
      credentials: spec.fields.map((field) => ({
        key: field.key,
        label: field.label,
        configured: Boolean(saved[field.key]),
      })),
    };
  });
  return { groupReply, channels };
}

export function saveChannel(input: unknown, store = getChannelStore()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ChatError("渠道设置格式不正确");
  }
  const value = input as Record<string, unknown>;
  const groupReply = value.groupReply;
  const channelId = value.id;
  if (groupReply === undefined && channelId === undefined) throw new ChatError("没有要保存的内容");
  if (groupReply !== undefined && !isGroupReply(groupReply)) {
    throw new ChatError("请选择新群的默认响应方式");
  }
  if (value.clearCredentials !== undefined && typeof value.clearCredentials !== "boolean") {
    throw new ChatError("凭据格式不正确");
  }
  if (channelId === undefined) {
    if (!isGroupReply(groupReply)) throw new ChatError("请选择新群的默认响应方式");
    store.db.prepare("UPDATE channel_prefs SET group_reply = ? WHERE id = 1").run(groupReply);
    return readChannels(store);
  }
  if (!isChannelId(channelId)) throw new ChatError("未知渠道");
  const spec = channelSpec(channelId);
  const row = store.db
    .prepare("SELECT enabled, secret FROM channels WHERE id = ?")
    .get(channelId) as { enabled: number; secret: string } | undefined;
  if (!row) throw new ChatError("未知渠道", 500);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new ChatError("启用状态格式不正确");
  }
  const enabled = value.enabled === undefined ? row.enabled === 1 : value.enabled;
  const next = mergeCredentials(
    readCredentials(store.directory, row.secret),
    value.credentials,
    spec.fields.map((field) => field.key),
    value.clearCredentials === true,
  );
  const secret = Object.keys(next).length > 0 ? sealJson(store.directory, next) : "";
  store.db.exec("BEGIN IMMEDIATE");
  try {
    if (isGroupReply(groupReply)) {
      store.db.prepare("UPDATE channel_prefs SET group_reply = ? WHERE id = 1").run(groupReply);
    }
    store.db
      .prepare("UPDATE channels SET enabled = ?, secret = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, secret, Date.now(), channelId);
    store.db.exec("COMMIT");
  } catch (error) {
    rollback(store.db);
    throw error;
  }
  return readChannels(store);
}

export function issuePairCode(channelId: unknown, store = getChannelStore()) {
  if (!isChannelId(channelId)) throw new ChatError("未知渠道");
  const row = store.db.prepare("SELECT enabled FROM channels WHERE id = ?").get(channelId) as
    | { enabled: number }
    | undefined;
  if (!row || row.enabled !== 1) throw new ChatError("请先启用该渠道再生成配对码");
  const now = Date.now();
  const expiresAt = now + PAIR_TTL_MS;
  let code = "";
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.db.prepare("DELETE FROM pair_codes WHERE channel_id = ? AND used_at IS NULL").run(channelId);
    let inserted = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = randomCode();
      if (store.db.prepare("SELECT code FROM pair_codes WHERE code = ?").get(code)) continue;
      store.db
        .prepare(
          "INSERT INTO pair_codes(code, channel_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
        )
        .run(code, channelId, now, expiresAt);
      inserted = true;
      break;
    }
    if (!inserted) throw new ChatError("暂时无法生成配对码，请重试", 503);
    store.db.exec("COMMIT");
  } catch (error) {
    rollback(store.db);
    throw error;
  }
  return { channelId, code, command: `/pair ${code}`, expiresAt };
}

export function submitPairCommand(text: unknown, store = getChannelStore()) {
  const parsed = parsePairCommand(text);
  if (!parsed.ok) throw new ChatError(parsed.error);
  const now = Date.now();
  let channelId: ChannelId | undefined;
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const row = store.db
      .prepare(
        "SELECT channel_id AS channelId, expires_at AS expiresAt, used_at AS usedAt FROM pair_codes WHERE code = ?",
      )
      .get(parsed.code) as
      | { channelId: string; expiresAt: number; usedAt: number | null }
      | undefined;
    if (!row || row.usedAt !== null || !isChannelId(row.channelId)) {
      throw new ChatError("配对码不正确，已拒绝");
    }
    if (row.expiresAt <= now) throw new ChatError("配对码已过期，请重新生成");
    const updated = store.db
      .prepare(
        "UPDATE pair_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?",
      )
      .run(now, parsed.code, now);
    if (Number(updated.changes) !== 1) throw new ChatError("配对码不正确，已拒绝");
    store.db.prepare("UPDATE channels SET paired_at = ? WHERE id = ?").run(now, row.channelId);
    channelId = row.channelId;
    store.db.exec("COMMIT");
  } catch (error) {
    rollback(store.db);
    throw error;
  }
  if (!channelId) throw new ChatError("配对码不正确，已拒绝");
  return {
    ok: true as const,
    channelId,
    channelName: channelSpec(channelId).name,
    pairedAt: now,
  };
}

function storedTelegramToken(store: ChannelStore) {
  const row = store.db.prepare("SELECT secret FROM channels WHERE id = 'telegram'").get() as
    | { secret: string }
    | undefined;
  return row ? readCredentials(store.directory, row.secret).botToken || "" : "";
}

export async function verifyTelegramToken(
  provided: unknown,
  store = getChannelStore(),
  fetchImpl: typeof fetch = fetch,
) {
  const override = typeof provided === "string" ? provided.trim() : "";
  if (provided !== undefined && provided !== null && typeof provided !== "string") {
    throw new ChatError("Telegram Token 格式不正确");
  }
  const token = override || storedTelegramToken(store);
  if (!token) throw new ChatError("请先填写 Telegram Bot Token");
  if (!isTelegramToken(token)) throw new ChatError("Telegram Token 格式不正确");
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ChatError("无法连接 Telegram，请检查网络后重试", 502);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ChatError("Telegram 没有返回可识别的校验结果", 502);
  }
  const body = payload as { ok?: unknown; result?: { username?: unknown } };
  if (!response.ok || !payload || typeof payload !== "object" || body.ok !== true) {
    throw new ChatError("Telegram 拒绝了这个 Token");
  }
  const username = body.result?.username;
  if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(username)) {
    return { ok: true as const, message: "Telegram Token 校验通过" };
  }
  return {
    ok: true as const,
    username,
    message: `Telegram 机器人 @${username} 校验通过`,
  };
}
