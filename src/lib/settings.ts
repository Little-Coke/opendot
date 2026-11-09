import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  linkSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ChatError, ChatStore, getStore } from "./chat-store";
import { normalizeBaseUrl } from "./provider";
import type { ModelSettings } from "./chat-types";

type Config = { baseUrl: string; model: string; apiKey: string };
function encryptionKey(store: ChatStore) {
  const path = join(store.directory, "settings.key");
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, randomBytes(32), { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    unlinkSync(temporary);
  }
  chmodSync(path, 0o600);
  return readFileSync(path);
}
function storedConfig(store: ChatStore): Config {
  const row = store.db.prepare("SELECT value FROM settings WHERE id = 1").get();
  if (!row)
    return {
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      apiKey: "",
    };
  const envelope = JSON.parse(String(row.value));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(store),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export function readModelConfig(
  store = getStore(),
  env: Record<string, string | undefined> = process.env,
): Config {
  const saved = storedConfig(store);
  return {
    baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL || saved.baseUrl),
    model: env.OPENAI_MODEL || saved.model,
    apiKey: env.OPENAI_API_KEY || saved.apiKey,
  };
}
export function publicModelSettings(
  store = getStore(),
  env: Record<string, string | undefined> = process.env,
): ModelSettings {
  const config = readModelConfig(store, env);
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasKey: !!config.apiKey,
    source: !config.apiKey
      ? "demo"
      : env.OPENAI_API_KEY || env.OPENAI_BASE_URL || env.OPENAI_MODEL
        ? "environment"
        : "settings",
  };
}
export function saveModelConfig(input: unknown, store = getStore()) {
  if (!input || typeof input !== "object")
    throw new ChatError("模型设置格式不正确");
  const value = input as Record<string, unknown>;
  if (
    typeof value.baseUrl !== "string" ||
    value.baseUrl.length > 2000 ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 200
  ) {
    throw new ChatError("请填写 API 地址和模型名");
  }
  if (
    value.apiKey !== undefined &&
    (typeof value.apiKey !== "string" ||
      value.apiKey.length > 4096 ||
      /[\r\n]/.test(value.apiKey))
  )
    throw new ChatError("API Key 格式不正确");
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(value.baseUrl);
  } catch {
    throw new ChatError(
      "API 地址须为有效的 HTTP(S) 地址，不含账号、查询参数或片段",
    );
  }
  const saved = storedConfig(store);
  const config: Config = {
    baseUrl,
    model: value.model.trim(),
    apiKey:
      value.clearKey === true
        ? ""
        : (value.apiKey as string | undefined)?.trim() || saved.apiKey,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(store), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  const envelope = JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
  store.db
    .prepare(
      "INSERT INTO settings(id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    )
    .run(envelope);
}
