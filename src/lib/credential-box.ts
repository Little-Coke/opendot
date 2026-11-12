import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChatError } from "./chat-store";

function readKey(path: string) {
  try {
    const key = readFileSync(path);
    if (key.length !== 32) throw new ChatError("加密密钥不可用", 500);
    return key;
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

/** 读取数据卷里已有的 settings.key。不存在时按同样的 AES-256-GCM 密钥方式创建。 */
export function credentialKey(directory: string) {
  const path = join(directory, "settings.key");
  const existing = readKey(path);
  if (existing) return existing;
  const temporary = `${path}.${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, randomBytes(32), { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  chmodSync(path, 0o600);
  const key = readKey(path);
  if (!key) throw new ChatError("加密密钥不可用", 500);
  return key;
}

export function sealJson(directory: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(directory), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

export function openJson(directory: string, envelope: string) {
  let parsed: { iv?: unknown; tag?: unknown; data?: unknown };
  try {
    parsed = JSON.parse(envelope) as { iv?: unknown; tag?: unknown; data?: unknown };
  } catch {
    throw new ChatError("凭据无法读取", 500);
  }
  if (
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.data !== "string"
  ) {
    throw new ChatError("凭据无法读取", 500);
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      credentialKey(directory),
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError("凭据无法读取", 500);
  }
}
