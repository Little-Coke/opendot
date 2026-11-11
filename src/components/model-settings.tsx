"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ModelSettings } from "@/lib/chat-types";

export function ModelSettingsForm() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取设置失败");
      setSettings(result);
      setBaseUrl(result.baseUrl);
      setModel(result.model);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法连接服务端");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="settings-layout">
      <form
        className="settings-form space-y-6"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const response = await fetch("/api/settings", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ baseUrl, model, apiKey, clearKey }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "保存失败");
            setSettings(result);
            setBaseUrl(result.baseUrl);
            setModel(result.model);
            setApiKey("");
            setClearKey(false);
            setMessage(
              result.source === "environment"
                ? "已保存。服务器环境变量优先生效。"
                : result.hasKey
                  ? "模型配置已保存，可以返回对话验证。"
                  : "已保存，当前使用演示模式。",
            );
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "保存失败，请重试",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 className="settings-title">模型提供商</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            连接 OpenAI 兼容接口。API Key
            加密保存在服务端，留空会保留已保存的密钥。
          </p>
        </div>
        {settings?.source === "environment" && (
          <p className="rounded-lg bg-accent-soft p-3 text-sm text-accent">
            服务器环境变量优先于此处保存的配置。
          </p>
        )}
        <label className="block text-sm">
          Base URL
          <input
            className="field mt-2"
            type="url"
            required
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </label>
        <label className="block text-sm">
          模型名
          <input
            className="field mt-2"
            required
            maxLength={200}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="deepseek-flash"
          />
        </label>
        <label className="block text-sm">
          API Key
          <span className="ml-2 text-xs text-muted">
            {settings?.hasKey ? "已配置 ••••••••" : "尚未配置"}
          </span>
          <input
            className="field mt-2"
            type="password"
            autoComplete="new-password"
            maxLength={4096}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              settings?.hasKey ? "留空保留现有密钥" : "输入服务商提供的 API Key"
            }
          />
        </label>
        {settings?.hasKey && settings.source !== "environment" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(event) => setClearKey(event.target.checked)}
            />
            清除已保存的密钥，切换为演示模式
          </label>
        )}
        <div className="flex items-center gap-4">
          <button className="primary-button" disabled={busy || !settings}>
            {busy ? "正在保存…" : "保存模型设置"}
          </button>
          <Link className="text-sm text-accent" href="/c/xiaodian">
            返回对话
          </Link>
        </div>
        {message && (
          <p className="text-sm text-emerald-700" role="status">
            {message}
          </p>
        )}
        {error && (
          <div role="alert" className="text-sm text-red-600">
            {error}
            <button
              type="button"
              className="ml-3 text-accent"
              onClick={() => void load()}
            >
              重新读取
            </button>
          </div>
        )}
      </form>
      <div className="settings-aside space-y-4">
        <h2 className="font-semibold">访问与对话</h2>
        <p className="text-sm leading-6 text-muted">
          对话自动保存在服务器。一次回复完成后可以继续发送，刷新页面会恢复当前对话。
        </p>
        <button
          className="text-sm text-accent"
          onClick={async () => {
            await fetch("/api/auth", { method: "DELETE" });
            window.location.reload();
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
