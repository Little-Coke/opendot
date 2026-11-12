"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CHANNELS,
  GROUP_REPLIES,
  type ChannelId,
  type ChannelSnapshot,
  type GroupReply,
} from "@/lib/channel-profile";
import type { DeviceSnapshot, PairedDevice } from "@/lib/device-profile";
import styles from "./channel-devices.module.css";

type Drafts = Record<string, Record<string, string>>;

async function readBody(response: Response) {
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result as Record<string, unknown>;
}

export function ChannelDevices() {
  const [channels, setChannels] = useState<ChannelSnapshot | null>(null);
  const [devices, setDevices] = useState<DeviceSnapshot | null>(null);
  const [groupReply, setGroupReply] = useState<GroupReply>("mention");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Drafts>({});
  const [pairCodes, setPairCodes] = useState<Record<string, string>>({});
  const [pairDrafts, setPairDrafts] = useState<Record<string, string>>({});
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceName, setDeviceName] = useState("本地节点");
  const [channelError, setChannelError] = useState("");
  const [channelMessage, setChannelMessage] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceMessage, setDeviceMessage] = useState("");
  const [telegramMessage, setTelegramMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function applyChannels(snapshot: ChannelSnapshot) {
    setChannels(snapshot);
    setGroupReply(snapshot.groupReply);
    setEnabled(Object.fromEntries(snapshot.channels.map((channel) => [channel.id, channel.enabled])));
  }

  const loadChannels = useCallback(async () => {
    setChannelError("");
    const response = await fetch("/api/channels", { cache: "no-store" });
    const result = await readBody(response);
    applyChannels(result as unknown as ChannelSnapshot);
  }, []);

  const loadDevices = useCallback(async () => {
    setDeviceError("");
    const response = await fetch("/api/devices", { cache: "no-store" });
    const result = await readBody(response);
    setDevices(result as unknown as DeviceSnapshot);
  }, []);

  useEffect(() => {
    void loadChannels().catch((failure: unknown) => {
      setChannelError(failure instanceof Error ? failure.message : "无法连接服务端");
    });
    void loadDevices().catch((failure: unknown) => {
      setDeviceError(failure instanceof Error ? failure.message : "无法连接服务端");
    });
  }, [loadChannels, loadDevices]);

  async function saveGroupReply() {
    setBusy(true);
    setChannelError("");
    setChannelMessage("");
    try {
      const response = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupReply }),
      });
      applyChannels((await readBody(response)) as unknown as ChannelSnapshot);
      setChannelMessage("新群默认响应方式已保存。");
    } catch (failure) {
      setChannelError(failure instanceof Error ? failure.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function saveChannel(id: ChannelId) {
    setBusy(true);
    setChannelError("");
    setChannelMessage("");
    try {
      const response = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          enabled: Boolean(enabled[id]),
          credentials: drafts[id] ?? {},
        }),
      });
      applyChannels((await readBody(response)) as unknown as ChannelSnapshot);
      setDrafts((current) => ({ ...current, [id]: {} }));
      setChannelMessage("渠道已保存。凭据不会再次显示。");
    } catch (failure) {
      setChannelError(failure instanceof Error ? failure.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function issueChannelCode(id: ChannelId) {
    setBusy(true);
    setChannelError("");
    setChannelMessage("");
    try {
      const response = await fetch("/api/channels/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue", channelId: id }),
      });
      const result = await readBody(response);
      const command = String(result.command || "");
      setPairCodes((current) => ({ ...current, [id]: command }));
      setChannelMessage(command ? `配对命令已生成，10 分钟内有效。` : "配对码已生成。");
    } catch (failure) {
      setChannelError(failure instanceof Error ? failure.message : "无法生成配对码");
    } finally {
      setBusy(false);
    }
  }

  async function submitChannelPair(id: ChannelId) {
    const raw = pairDrafts[id]?.trim() ?? "";
    const text = raw.startsWith("/pair") ? raw : raw ? `/pair ${raw}` : "/pair";
    setBusy(true);
    setChannelError("");
    setChannelMessage("");
    try {
      const response = await fetch("/api/channels/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", text }),
      });
      const result = await readBody(response);
      setChannelMessage(`已接受 ${String(result.channelName || "渠道")} 的配对。`);
      setPairDrafts((current) => ({ ...current, [id]: "" }));
      await loadChannels();
    } catch (failure) {
      setChannelError(failure instanceof Error ? failure.message : "配对失败");
    } finally {
      setBusy(false);
    }
  }

  async function verifyTelegram() {
    const token = drafts.telegram?.botToken?.trim();
    setBusy(true);
    setChannelError("");
    setTelegramMessage("");
    try {
      const response = await fetch("/api/channels/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { token } : {}),
      });
      const result = await readBody(response);
      setTelegramMessage(String(result.message || "Telegram Token 校验通过"));
    } catch (failure) {
      setChannelError(failure instanceof Error ? failure.message : "校验失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveNodes(next: boolean) {
    setBusy(true);
    setDeviceError("");
    setDeviceMessage("");
    try {
      const response = await fetch("/api/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodesEnabled: next }),
      });
      setDevices((await readBody(response)) as unknown as DeviceSnapshot);
      if (!next) setDeviceCode("");
      setDeviceMessage(next ? "设备节点已开启。" : "设备节点已关闭。未使用的配对码已失效。");
    } catch (failure) {
      setDeviceError(failure instanceof Error ? failure.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function issueDevicePair() {
    setBusy(true);
    setDeviceError("");
    setDeviceMessage("");
    try {
      const response = await fetch("/api/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue" }),
      });
      const result = await readBody(response);
      setDeviceCode(String(result.code || ""));
      setDeviceMessage("配对码已生成，10 分钟内有效。");
    } catch (failure) {
      setDeviceError(failure instanceof Error ? failure.message : "无法生成配对码");
    } finally {
      setBusy(false);
    }
  }

  async function simulatePair() {
    setBusy(true);
    setDeviceError("");
    setDeviceMessage("");
    try {
      const response = await fetch("/api/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simulate", code: deviceCode, name: deviceName }),
      });
      const result = (await readBody(response)) as unknown as PairedDevice;
      setDeviceCode("");
      setDeviceMessage(`已配对「${result.name}」。${result.assignmentText}`);
      await loadDevices();
    } catch (failure) {
      setDeviceError(failure instanceof Error ? failure.message : "配对失败");
    } finally {
      setBusy(false);
    }
  }

  async function togglePresence(device: PairedDevice) {
    setBusy(true);
    setDeviceError("");
    setDeviceMessage("");
    try {
      const response = await fetch("/api/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: device.id,
          status: device.status === "online" ? "offline" : "online",
        }),
      });
      setDevices((await readBody(response)) as unknown as DeviceSnapshot);
    } catch (failure) {
      setDeviceError(failure instanceof Error ? failure.message : "无法更新设备状态");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="channel-settings">
        <h2 id="channel-settings" className={styles.title}>
          渠道
        </h2>
        <p className={styles.help}>
          连接飞书、Telegram、QQ、微信、钉钉、Discord 和 WhatsApp。凭据加密保存在服务器，保存后不会再显示出来。
        </p>
        <div className={styles.choices} role="radiogroup" aria-label="新群默认响应方式">
          {GROUP_REPLIES.map((item) => (
            <label key={item.id} className={styles.choice}>
              <input
                type="radio"
                name="group-reply"
                checked={groupReply === item.id}
                onChange={() => setGroupReply(item.id)}
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className={`${styles.actions} mt-3`}>
          <button type="button" className="secondary-button" disabled={busy || !channels} onClick={() => void saveGroupReply()}>
            保存响应方式
          </button>
        </div>
        {channelMessage && (
          <p className={`${styles.message} ${styles.ok}`} role="status">
            {channelMessage}
          </p>
        )}
        {channelError && (
          <p className={`${styles.message} ${styles.bad}`} role="alert">
            {channelError}
          </p>
        )}
        <div className={styles.grid}>
          {(channels?.channels ?? CHANNELS.map((channel) => ({
            id: channel.id,
            name: channel.name,
            enabled: false,
            paired: false,
            credentials: channel.fields.map((field) => ({
              key: field.key,
              label: field.label,
              configured: false,
            })),
          }))).map((channel) => (
            <article key={channel.id} className={styles.card}>
              <div className={styles.head}>
                <h3 className={styles.name}>{channel.name}</h3>
                {channel.paired && <span className={`${styles.badge} ${styles.online}`}>已配对</span>}
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={Boolean(enabled[channel.id])}
                  onChange={(event) =>
                    setEnabled((current) => ({ ...current, [channel.id]: event.target.checked }))
                  }
                />
                {enabled[channel.id] ? "已启用" : "已停用"}
              </label>
              {channel.credentials.map((field) => (
                <label key={field.key} className="block text-sm">
                  {field.label}
                  <span className="ml-2 text-xs text-muted">
                    {field.configured ? "已填写 ••••••••" : "尚未填写"}
                  </span>
                  <input
                    className="field mt-2"
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={4096}
                    value={drafts[channel.id]?.[field.key] ?? ""}
                    placeholder={field.configured ? "留空保留已保存的凭据" : "填写后加密保存"}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [channel.id]: { ...current[channel.id], [field.key]: event.target.value },
                      }))
                    }
                  />
                </label>
              ))}
              <div className={styles.actions}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !channels}
                  onClick={() => void saveChannel(channel.id)}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !channels}
                  onClick={() => void issueChannelCode(channel.id)}
                >
                  生成配对码
                </button>
                {channel.id === "telegram" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !channels}
                    onClick={() => void verifyTelegram()}
                  >
                    校验 Token
                  </button>
                )}
              </div>
              {channel.id === "telegram" && (
                <p className={styles.note}>只请求 Telegram 的 getMe 确认 Token，不会注册 webhook。</p>
              )}
              {telegramMessage && channel.id === "telegram" && (
                <p className={`${styles.message} ${styles.ok}`} role="status">
                  {telegramMessage}
                </p>
              )}
              {pairCodes[channel.id] && (
                <p className={styles.note}>
                  配对命令 <span className={styles.code}>{pairCodes[channel.id]}</span>
                  ，10 分钟内有效。
                </p>
              )}
              <div className={styles.pairRow}>
                <input
                  className="field"
                  aria-label={`${channel.name} 配对命令`}
                  placeholder="/pair 配对码"
                  value={pairDrafts[channel.id] ?? ""}
                  onChange={(event) =>
                    setPairDrafts((current) => ({ ...current, [channel.id]: event.target.value }))
                  }
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !channels}
                  onClick={() => void submitChannelPair(channel.id)}
                >
                  提交配对
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="device-settings">
        <h2 id="device-settings" className={styles.title}>
          设备
        </h2>
        <p className={styles.help}>
          {devices?.offlinePolicyText ?? "设备离线时，任务会等待原设备，不会改派。"}
          设备节点默认关闭，开启后才能生成配对码。
        </p>
        <label className={`${styles.toggle} mt-3`}>
          <input
            type="checkbox"
            checked={Boolean(devices?.nodesEnabled)}
            disabled={busy || !devices}
            onChange={(event) => void saveNodes(event.target.checked)}
          />
          开启设备节点
        </label>
        {devices?.nodesEnabled && (
          <div className="mt-4 space-y-3">
            <div className={styles.actions}>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void issueDevicePair()}>
                生成配对码
              </button>
              {deviceCode && <span className={styles.code}>{deviceCode}</span>}
            </div>
            <label className="block text-sm">
              模拟节点名称
              <input
                className="field mt-2"
                maxLength={40}
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !deviceCode}
              onClick={() => void simulatePair()}
            >
              模拟本地节点提交
            </button>
          </div>
        )}
        {deviceMessage && (
          <p className={`${styles.message} ${styles.ok} mt-3`} role="status">
            {deviceMessage}
          </p>
        )}
        {deviceError && (
          <p className={`${styles.message} ${styles.bad} mt-3`} role="alert">
            {deviceError}
            <button type="button" className="ml-3 text-accent" onClick={() => void loadDevices()}>
              重新读取
            </button>
          </p>
        )}
        <div className={styles.list}>
          {devices && devices.devices.length === 0 && (
            <p className={styles.note}>还没有配对的设备。开启节点后生成配对码，再用「模拟本地节点提交」完成配对。</p>
          )}
          {devices?.devices.map((device) => (
            <article key={device.id} className={styles.device}>
              <div className={styles.head}>
                <h3 className={styles.name}>{device.name}</h3>
                <span className={`${styles.badge} ${device.status === "online" ? styles.online : styles.offline}`}>
                  {device.status === "online" ? "在线" : "离线"}
                </span>
              </div>
              <p className={styles.note}>{device.assignmentText}</p>
              <div className={styles.actions}>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void togglePresence(device)}>
                  {device.status === "online" ? "标为离线" : "标为在线"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
