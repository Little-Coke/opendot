import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore, closeChannelStore } from "./channels";
import { DEVICE_LIMIT } from "./device-profile";
import {
  issueDeviceCode,
  readDevices,
  setDeviceStatus,
  setNodesEnabled,
  simulateLocalNode,
} from "./devices";

describe("devices", () => {
  let directory = "";
  let store: ChannelStore | undefined;

  afterEach(() => {
    try {
      store?.db.close();
    } catch {
      // 本例里可能已经关掉。
    }
    store = undefined;
    closeChannelStore();
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = "";
  });

  function open() {
    directory = mkdtempSync(join(tmpdir(), "opendot-devices-"));
    store = new ChannelStore(directory);
    return store;
  }

  it("keeps device nodes off and rejects pairing until they are enabled", () => {
    const current = open();
    expect(readDevices(current)).toMatchObject({
      nodesEnabled: false,
      offlinePolicy: "wait",
      devices: [],
    });
    expect(readDevices(current).offlinePolicyText).toContain("不会改派");
    expect(() => issueDeviceCode(current)).toThrow(/尚未开启/);
    expect(() => simulateLocalNode({ code: "ABCDEFGH", name: "本地节点" }, current)).toThrow(/尚未开启/);
    expect(readDevices(current).devices).toEqual([]);
  });

  it("completes a simulated pairing and keeps offline work on the same device", () => {
    const current = open();
    setNodesEnabled(true, current);
    const issued = issueDeviceCode(current);
    const wrong = issued.code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA";
    expect(() => simulateLocalNode({ code: wrong, name: "客厅电脑" }, current)).toThrow(/配对码不正确，已拒绝/);
    expect(() => simulateLocalNode({ code: issued.code, assignment: "reassign" }, current)).toThrow(/不能改派/);
    const device = simulateLocalNode({ code: issued.code, name: " 客厅电脑 " }, current);
    expect(device).toMatchObject({
      name: "客厅电脑",
      status: "online",
      assignment: "wait",
      reassign: false,
    });
    expect(device.id).toMatch(/^node_[a-f0-9]{16}$/);
    expect(device.assignmentText).toContain("不会改派");
    expect(() => simulateLocalNode({ code: issued.code }, current)).toThrow(/配对码不正确，已拒绝/);
    const offline = setDeviceStatus(device.id, "offline", current);
    expect(offline.status).toBe("offline");
    expect(offline.assignment).toBe("wait");
    expect(offline.reassign).toBe(false);
    expect(offline.assignmentText).toContain("当前离线");
    expect(offline.assignmentText).toContain("不会改派");
    const stored = current.db.prepare("SELECT assignment, status FROM devices WHERE id = ?").get(device.id) as {
      assignment: string;
      status: string;
    };
    expect(stored).toEqual({ assignment: "wait", status: "offline" });
    expect(() => current.db.prepare("UPDATE devices SET assignment = 'reassign' WHERE id = ?").run(device.id)).toThrow();
    setNodesEnabled(false, current);
    expect(readDevices(current).nodesEnabled).toBe(false);
    expect(readDevices(current).devices[0]?.id).toBe(device.id);
    setNodesEnabled(true, current);
    const replacement = issueDeviceCode(current);
    setNodesEnabled(false, current);
    setNodesEnabled(true, current);
    expect(() => simulateLocalNode({ code: replacement.code }, current)).toThrow(/配对码不正确，已拒绝/);
  });

  it("stops at the device limit without saving another node", () => {
    const current = open();
    setNodesEnabled(true, current);
    for (let index = 0; index < DEVICE_LIMIT; index += 1) {
      const code = issueDeviceCode(current);
      simulateLocalNode({ code: code.code, name: `节点${index}` }, current);
    }
    const extra = issueDeviceCode(current);
    expect(() => simulateLocalNode({ code: extra.code, name: "多出来" }, current)).toThrow(/30/);
    expect(readDevices(current).devices).toHaveLength(DEVICE_LIMIT);
    expect(readDevices(current).devices.some((device) => device.name === "多出来")).toBe(false);
  });
});
