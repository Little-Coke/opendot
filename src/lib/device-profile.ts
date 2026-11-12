export const DEVICE_NAME_MAX = 40;
export const DEVICE_LIMIT = 30;
export const DEVICE_ASSIGNMENT = "wait" as const;
export const OFFLINE_POLICY_TEXT = "设备离线时，任务会等待原设备，不会改派。";
export const DEVICE_ASSIGNMENT_TEXT = "离线时任务等待这台设备，不会改派。";

export type DeviceStatus = "online" | "offline";

export type PairedDevice = {
  id: string;
  name: string;
  status: DeviceStatus;
  assignment: typeof DEVICE_ASSIGNMENT;
  reassign: false;
  assignmentText: string;
  pairedAt: number;
};

export type DeviceSnapshot = {
  nodesEnabled: boolean;
  offlinePolicy: typeof DEVICE_ASSIGNMENT;
  offlinePolicyText: string;
  devices: PairedDevice[];
};

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

export function isDeviceStatus(value: unknown): value is DeviceStatus {
  return value === "online" || value === "offline";
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^node_[a-f0-9]{16}$/.test(value);
}

export function readDeviceName(value: unknown):
  | { ok: true; name: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "设备名称格式不正确" };
  const name = value.trim();
  if (!name) return { ok: false, error: "请填写设备名称" };
  if (name.length > DEVICE_NAME_MAX) {
    return { ok: false, error: `设备名称请控制在 ${DEVICE_NAME_MAX} 个字以内` };
  }
  if (CONTROL.test(name)) return { ok: false, error: "设备名称格式不正确" };
  return { ok: true, name };
}
