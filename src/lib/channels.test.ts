import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS, parsePairCommand } from "./channel-profile";
import {
  ChannelStore,
  closeChannelStore,
  getChannelStore,
  issuePairCode,
  readChannels,
  saveChannel,
  submitPairCommand,
  verifyTelegramToken,
} from "./channels";

const secret = "unit-secret-token-should-not-leak";
const telegramToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";

describe("channels", () => {
  let directory = "";
  let extra = "";
  let store: ChannelStore | undefined;

  afterEach(() => {
    try {
      store?.db.close();
    } catch {
      // 本例里可能已经关掉。
    }
    store = undefined;
    closeChannelStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (extra) rmSync(extra, { recursive: true, force: true });
    directory = "";
    extra = "";
  });

  function open() {
    directory = mkdtempSync(join(tmpdir(), "opendot-channels-"));
    store = new ChannelStore(directory);
    return store;
  }

  function filesContain(needle: string) {
    return readdirSync(directory)
      .filter((name) => name.startsWith("channels.sqlite") || name === "settings.key")
      .map((name) => readFileSync(join(directory, name)))
      .some((file) => file.includes(Buffer.from(needle)));
  }

  it("rejects malformed and unknown /pair codes", () => {
    expect(parsePairCommand("/pair")).toEqual({ ok: false, error: "配对码不正确，已拒绝" });
    expect(parsePairCommand("/pair NOT-A-CODE extra")).toEqual({
      ok: false,
      error: "配对码不正确，已拒绝",
    });
    expect(parsePairCommand("/pair 00000000").ok).toBe(false);
    const current = open();
    expect(() => submitPairCommand("/pair ABCDEFGH", current)).toThrow(/配对码不正确，已拒绝/);
    expect(readChannels(current).channels.every((channel) => channel.paired === false)).toBe(true);
  });

  it("accepts a real pairing code once and rejects it afterwards", () => {
    const current = open();
    saveChannel({ id: "telegram", enabled: true }, current);
    const issued = issuePairCode("telegram", current);
    expect(issued.command).toBe(`/pair ${issued.code}`);
    const paired = submitPairCommand(issued.command.toLowerCase(), current);
    expect(paired).toMatchObject({ ok: true, channelId: "telegram", channelName: "Telegram" });
    expect(readChannels(current).channels.find((channel) => channel.id === "telegram")?.paired).toBe(
      true,
    );
    expect(() => submitPairCommand(issued.command, current)).toThrow(/配对码不正确，已拒绝/);
    current.db.prepare("UPDATE pair_codes SET used_at = NULL, expires_at = 1 WHERE code = ?").run(issued.code);
    expect(() => submitPairCommand(issued.command, current)).toThrow(/配对码已过期/);
  });

  it("stores credentials encrypted and never returns them", () => {
    const current = open();
    const saved = saveChannel(
      {
        id: "feishu",
        enabled: true,
        credentials: { appId: "cli_example", appSecret: secret },
      },
      current,
    );
    expect(saved.channels.find((channel) => channel.id === "feishu")).toMatchObject({
      enabled: true,
      credentials: [
        { key: "appId", configured: true },
        { key: "appSecret", configured: true },
      ],
    });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(JSON.stringify(saved)).not.toContain("cli_example");
    expect(filesContain(secret)).toBe(false);
    expect(filesContain("cli_example")).toBe(false);
    const row = current.db.prepare("SELECT secret FROM channels WHERE id = 'feishu'").get() as {
      secret: string;
    };
    expect(row.secret).toContain("\"iv\"");
    expect(row.secret).not.toContain(secret);
    const kept = saveChannel(
      { id: "feishu", credentials: { appId: "" }, clearCredentials: false },
      current,
    );
    expect(kept.channels.find((channel) => channel.id === "feishu")?.credentials.every((field) => field.configured)).toBe(
      true,
    );
    expect(JSON.stringify(kept)).not.toContain(secret);
    expect(() =>
      saveChannel({ id: "feishu", credentials: { appSecret: secret, extra: "nope" } }, current),
    ).toThrow(/无法识别/);
  });

  it("keeps channels in their own database and defaults every channel to off", () => {
    const current = open();
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "channels.sqlite"), 0o644);
    current.db.close();
    store = new ChannelStore(directory);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "channels.sqlite")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "channels.sqlite-wal")).mode & 0o777).toBe(0o600);
    const snapshot = readChannels(store);
    expect(snapshot.groupReply).toBe("mention");
    expect(snapshot.channels.map((channel) => channel.id)).toEqual(CHANNELS.map((channel) => channel.id));
    expect(snapshot.channels.every((channel) => channel.enabled === false && channel.paired === false)).toBe(
      true,
    );
    expect(saveChannel({ groupReply: "all" }, store).groupReply).toBe("all");
    expect(() => saveChannel({ groupReply: "everyone" }, store)).toThrow(/响应方式/);
    const names = readdirSync(directory);
    expect(names.some((name) => name.startsWith("channels.sqlite"))).toBe(true);
    expect(names.some((name) => name.startsWith("opendot"))).toBe(false);
    expect(names.some((name) => name.startsWith("dots"))).toBe(false);
    expect(names.some((name) => name.startsWith("work"))).toBe(false);
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(tables).toContain("channels");
    expect(tables).toContain("devices");
    expect(tables).not.toContain("turns");
    expect(tables).not.toContain("dots");
    expect(tables).not.toContain("goals");
  });

  it("follows the data directory and explains Telegram network failures in Chinese", async () => {
    directory = mkdtempSync(join(tmpdir(), "opendot-channels-a-"));
    extra = mkdtempSync(join(tmpdir(), "opendot-channels-b-"));
    vi.stubEnv("DATA_DIR", directory);
    saveChannel({ id: "telegram", enabled: true, credentials: { botToken: telegramToken } });
    expect(JSON.stringify(readChannels())).not.toContain(telegramToken);
    vi.stubEnv("DATA_DIR", extra);
    expect(getChannelStore().directory).toBe(extra);
    expect(readChannels().channels.every((channel) => channel.enabled === false)).toBe(true);
    const calls: string[] = [];
    await expect(
      verifyTelegramToken(telegramToken, getChannelStore(), ((url: string) => {
        calls.push(url);
        return Promise.reject(new TypeError(`connect ${url}`));
      }) as typeof fetch),
    ).rejects.toThrow("无法连接 Telegram，请检查网络后重试");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/getMe");
    await expect(
      verifyTelegramToken("not-a-token", getChannelStore(), (() => {
        throw new Error("should not fetch");
      }) as typeof fetch),
    ).rejects.toThrow(/格式不正确/);
    store = new ChannelStore(directory);
    const verified = await verifyTelegramToken(
      undefined,
      store,
      (async () =>
        new Response(JSON.stringify({ ok: true, result: { id: 1, username: "opendot_bot" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );
    expect(verified.message).toContain("@opendot_bot");
    expect(JSON.stringify(verified)).not.toContain(telegramToken);
  });
});
