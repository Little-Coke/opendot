import { randomBytes } from "node:crypto";
import { ChatError } from "./chat-store";
import { PAIR_TTL_MS, normalizePairCode } from "./channel-profile";
import { getChannelStore, type ChannelStore } from "./channels";
import {
  DEVICE_ASSIGNMENT,
  DEVICE_ASSIGNMENT_TEXT,
  DEVICE_LIMIT,
  OFFLINE_POLICY_TEXT,
  isDeviceId,
  isDeviceStatus,
  readDeviceName,
  type DeviceSnapshot,
  type PairedDevice,
} from "./device-profile";

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type DeviceRow = {
  id: string;
  name: string;
  status: string;
  assignment: string;
  pairedAt: number;
};

function randomCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += PAIR_ALPHABET[byte % PAIR_ALPHABET.length];
  return code;
}

function rollback(store: ChannelStore) {
  try {
    store.db.exec("ROLLBACK");
  } catch {
    // 事务可能尚未开始。
  }
}

function nodesEnabled(store: ChannelStore) {
  const row = store.db
    .prepare("SELECT nodes_enabled AS nodesEnabled FROM device_prefs WHERE id = 1")
    .get() as { nodesEnabled: number } | undefined;
  return row?.nodesEnabled === 1;
}

function toDevice(row: DeviceRow): PairedDevice | undefined {
  if (!isDeviceId(row.id) || !isDeviceStatus(row.status) || row.assignment !== DEVICE_ASSIGNMENT) {
    return undefined;
  }
  const offline = row.status === "offline";
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    assignment: DEVICE_ASSIGNMENT,
    reassign: false,
    assignmentText: offline
      ? "这台设备当前离线，任务会继续等待它，不会改派给其他节点。"
      : DEVICE_ASSIGNMENT_TEXT,
    pairedAt: Number(row.pairedAt),
  };
}

export function readDevices(store = getChannelStore()): DeviceSnapshot {
  const rows = store.db
    .prepare(
      `SELECT id, name, status, assignment, paired_at AS pairedAt
       FROM devices ORDER BY paired_at DESC, rowid DESC`,
    )
    .all() as DeviceRow[];
  return {
    nodesEnabled: nodesEnabled(store),
    offlinePolicy: DEVICE_ASSIGNMENT,
    offlinePolicyText: OFFLINE_POLICY_TEXT,
    devices: rows.flatMap((row) => {
      const device = toDevice(row);
      return device ? [device] : [];
    }),
  };
}

export function setNodesEnabled(enabled: unknown, store = getChannelStore()) {
  if (typeof enabled !== "boolean") throw new ChatError("设备节点开关格式不正确");
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.db.prepare("UPDATE device_prefs SET nodes_enabled = ? WHERE id = 1").run(enabled ? 1 : 0);
    if (!enabled) store.db.prepare("DELETE FROM device_codes WHERE used_at IS NULL").run();
    store.db.exec("COMMIT");
  } catch (error) {
    rollback(store);
    throw error;
  }
  return readDevices(store);
}

export function issueDeviceCode(store = getChannelStore()) {
  if (!nodesEnabled(store)) throw new ChatError("设备节点尚未开启");
  const now = Date.now();
  const expiresAt = now + PAIR_TTL_MS;
  let code = "";
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.db.prepare("DELETE FROM device_codes WHERE used_at IS NULL").run();
    let inserted = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = randomCode();
      if (store.db.prepare("SELECT code FROM device_codes WHERE code = ?").get(code)) continue;
      store.db
        .prepare(
          "INSERT INTO device_codes(code, created_at, expires_at, used_at) VALUES (?, ?, ?, NULL)",
        )
        .run(code, now, expiresAt);
      inserted = true;
      break;
    }
    if (!inserted) throw new ChatError("暂时无法生成配对码，请重试", 503);
    store.db.exec("COMMIT");
  } catch (error) {
    rollback(store);
    throw error;
  }
  return { code, expiresAt };
}

export function simulateLocalNode(input: unknown, store = getChannelStore()) {
  if (!nodesEnabled(store)) throw new ChatError("设备节点尚未开启");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ChatError("配对码不正确，已拒绝");
  }
  const value = input as Record<string, unknown>;
  if (value.assignment !== undefined && value.assignment !== DEVICE_ASSIGNMENT) {
    throw new ChatError("设备离线时只会等待原设备，不能改派");
  }
  const code = normalizePairCode(value.code);
  if (!code) throw new ChatError("配对码不正确，已拒绝");
  const named = value.name === undefined ? { ok: true as const, name: "本地节点" } : readDeviceName(value.name);
  if (!named.ok) throw new ChatError(named.error);
  const now = Date.now();
  let id = "";
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const row = store.db
      .prepare("SELECT expires_at AS expiresAt, used_at AS usedAt FROM device_codes WHERE code = ?")
      .get(code) as { expiresAt: number; usedAt: number | null } | undefined;
    if (!row || row.usedAt !== null) throw new ChatError("配对码不正确，已拒绝");
    if (row.expiresAt <= now) throw new ChatError("配对码已过期，请重新生成");
    const count = store.db.prepare("SELECT COUNT(*) AS count FROM devices").get() as { count: number };
    if (Number(count.count) >= DEVICE_LIMIT) throw new ChatError(`最多配对 ${DEVICE_LIMIT} 台设备`);
    const consumed = store.db
      .prepare("UPDATE device_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?")
      .run(now, code, now);
    if (Number(consumed.changes) !== 1) throw new ChatError("配对码不正确，已拒绝");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `node_${randomBytes(8).toString("hex")}`;
      if (store.db.prepare("SELECT id FROM devices WHERE id = ?").get(candidate)) continue;
      id = candidate;
      break;
    }
    if (!id) throw new ChatError("暂时无法分配设备编号，请重试", 503);
    store.db
      .prepare(
        `INSERT INTO devices(id, name, status, assignment, paired_at, updated_at)
         VALUES (?, ?, 'online', 'wait', ?, ?)`,
      )
      .run(id, named.name, now, now);
    store.db.exec("COMMIT");
  } catch (error) {
    rollback(store);
    throw error;
  }
  const created = readDevices(store).devices.find((device) => device.id === id);
  if (!created) throw new ChatError("设备已配对但无法读取", 500);
  return created;
}

export function setDeviceStatus(id: unknown, status: unknown, store = getChannelStore()) {
  if (!isDeviceId(id)) throw new ChatError("找不到这台设备");
  if (!isDeviceStatus(status)) throw new ChatError("设备状态格式不正确");
  const updated = store.db
    .prepare("UPDATE devices SET status = ?, updated_at = ? WHERE id = ? AND assignment = 'wait'")
    .run(status, Date.now(), id);
  if (Number(updated.changes) !== 1) throw new ChatError("找不到这台设备");
  const device = readDevices(store).devices.find((item) => item.id === id);
  if (!device) throw new ChatError("找不到这台设备");
  return device;
}

export function assertWaitAssignment(assignment: unknown) {
  if (assignment !== undefined && assignment !== DEVICE_ASSIGNMENT) {
    throw new ChatError("设备离线时只会等待原设备，不能改派");
  }
}
