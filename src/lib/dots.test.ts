import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOT_LIMIT } from "./dot-profile";
import { closeDotStore, DotStore, getDotStore } from "./dots";

describe("dot store", () => {
  let directory = "";
  let extra = "";
  let store: DotStore | undefined;

  afterEach(() => {
    try {
      store?.db.close();
    } catch {
      // 本例里可能已经关掉。
    }
    store = undefined;
    closeDotStore();
    vi.unstubAllEnvs();
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (extra) rmSync(extra, { recursive: true, force: true });
    directory = "";
    extra = "";
  });

  function open() {
    directory = mkdtempSync(join(tmpdir(), "opendot-dots-"));
    store = new DotStore(directory);
    return store;
  }

  it("keeps custom dots in their own database across restarts", () => {
    const current = open();
    const created = current.create({
      name: " 资料员 ",
      shape: "rounded",
      color: "#14b8a6",
      role: "整理资料",
    });
    expect(created.id).toMatch(/^dot_[a-f0-9]{16}$/);
    current.create({ name: "校对", shape: "square", color: "#ef4444" });
    expect(current.list().map((dot) => dot.name)).toEqual(["资料员", "校对"]);
    current.db.close();
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "dots.sqlite"), 0o644);
    store = new DotStore(directory);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "dots.sqlite")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "dots.sqlite-wal")).mode & 0o777).toBe(0o600);
    expect(store.list()[0]).toMatchObject({
      name: "资料员",
      shape: "rounded",
      color: "#14b8a6",
      role: "整理资料",
    });
    expect(readdirSync(directory).some((name) => name.startsWith("opendot"))).toBe(false);
  });

  it("rejects invalid dots and stops at the team limit without partial writes", () => {
    const current = open();
    expect(() => current.create({ name: "小点", shape: "circle", color: "#3ecf8e" })).toThrow(
      /主 Dot/,
    );
    for (let index = 0; index < DOT_LIMIT; index += 1) {
      current.create({ name: `成员${index}`, shape: "circle", color: "#3b82f6" });
    }
    expect(() =>
      current.create({ name: "多出来", shape: "circle", color: "#3b82f6" }),
    ).toThrow(/24/);
    expect(current.list()).toHaveLength(DOT_LIMIT);
    const removed = current.list()[0];
    current.remove(removed.id);
    expect(current.get(removed.id)).toBeUndefined();
    expect(current.create({ name: "补位", shape: "diamond", color: "#f59e0b" }).name).toBe("补位");
    expect(() => current.remove("xiaodian")).toThrow(/没有这个 Dot/);
    expect(() => current.remove(`dot_${"b".repeat(16)}`)).toThrow(/没有这个 Dot/);
  });

  it("follows the data directory used by the volume", () => {
    directory = mkdtempSync(join(tmpdir(), "opendot-dots-a-"));
    extra = mkdtempSync(join(tmpdir(), "opendot-dots-b-"));
    vi.stubEnv("DATA_DIR", directory);
    getDotStore().create({ name: "只在第一处", shape: "circle", color: "#3b82f6" });
    vi.stubEnv("DATA_DIR", extra);
    expect(getDotStore().directory).toBe(extra);
    expect(getDotStore().list()).toEqual([]);
  });
});
