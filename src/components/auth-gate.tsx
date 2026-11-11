"use client";

import { DotFace } from "./shell";
import { useCallback, useEffect, useState } from "react";

type AuthState = {
  authenticated: boolean;
  configured: boolean;
  setupRequired: boolean;
};
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/auth", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setAuth(await response.json());
    } catch {
      setError("无法连接服务端，请检查网络后重试");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (auth?.authenticated) return children;
  return (
    <main className="login-page">
      <form
        className="login-card space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error || "登录失败，请重试");
            setPassword("");
            await load();
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : "无法连接服务端",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <DotFace />
          OpenDot
        </div>
        <div className="login-heading">
          <h1>
            你的想法，
            <br />
            有了一个好伙伴。
          </h1>
          <p>登录个人空间，和小点继续对话。</p>
        </div>
        {!auth && !error && (
          <p className="text-sm text-muted" role="status">
            正在连接服务端…
          </p>
        )}
        {auth?.setupRequired && (
          <p className="text-sm leading-6">
            请在服务器的环境变量中设置 OPENDOT_PASSWORD
            并重新部署，以启用个人对话和模型配置。
          </p>
        )}
        {auth?.configured && (
          <>
            <label className="block text-sm">
              访问密码
              <input
                className="field mt-2"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button
              className="w-full rounded-xl bg-accent py-3 text-white disabled:opacity-50"
              disabled={busy}
            >
              {busy ? "正在登录…" : "进入 OpenDot"}
            </button>
          </>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {(!auth || auth.setupRequired) && (
          <button
            className="text-sm text-accent"
            type="button"
            onClick={() => void load()}
          >
            重新连接
          </button>
        )}
      </form>
    </main>
  );
}
