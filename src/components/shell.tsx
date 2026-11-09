"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MOBILE_NAV, SIDE_LINKS, isActive } from "@/lib/nav";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const showXiaodian = !query.trim() || "小点".includes(query.trim());

  return (
    <div className="flex h-dvh bg-bg text-ink">
      <aside className={`hidden shrink-0 flex-col border-r border-line bg-sidebar lg:flex ${collapsed ? "w-[72px]" : "w-[268px]"}`}>
        <Link href="/" className="flex items-center gap-2 px-4 py-4 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-ink text-xs text-panel">OD</span>
          {collapsed ? null : "OpenDot"}
        </Link>
        {collapsed ? null : (
          <div className="px-3 pb-2">
            <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dot 和对话" aria-label="搜索 Dot 和对话" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2">
          <div className="kicker px-2 py-2">DOTS</div>
          {showXiaodian ? (
            <Link href="/" className="nav-btn" data-active={pathname === "/"}>
              <DotFace />
              {collapsed ? null : "小点"}
            </Link>
          ) : <p className="px-2 text-xs text-muted">没有匹配的 Dot</p>}
          <div className="kicker mt-4 px-2 py-2">GROUP CHATS</div>
          {collapsed ? null : <p className="px-2 text-xs text-muted">群聊即将开放</p>}
          {collapsed ? null : (
            <>
              <div className="kicker mt-4 px-2 py-2">RECENT</div>
              <Link href="/c/xiaodian" className="nav-btn" data-active={pathname === "/c/xiaodian"}>小点</Link>
            </>
          )}
        </div>
        <div className="space-y-1 border-t border-line p-2">
          <button className="nav-btn" type="button" onClick={() => setCollapsed((value) => !value)}>
            <span>☰</span>
            {collapsed ? null : "收起侧栏"}
          </button>
          {SIDE_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="nav-btn" data-active={isActive(item.href, pathname)}>
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          ))}
          <div className="nav-btn text-muted">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs text-accent">A</span>
            {collapsed ? null : "admin"}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <nav className={`${pathname.startsWith("/c/") ? "hidden" : "grid"} grid-cols-4 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden`}>
          {MOBILE_NAV.map((item) => {
            const active = isActive(item.href, pathname, item.href === "/work");
            return (
              <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 py-2 text-xs ${active ? "text-accent" : "text-muted"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function DotFace() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="18" fill="#3ecf8e" />
      <circle cx="18" cy="22" r="2.2" fill="#143024" />
      <circle cx="30" cy="22" r="2.2" fill="#143024" />
    </svg>
  );
}

export function StatusBar() {
  return (
    <div className="flex items-center justify-end gap-3 px-4 py-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        已连接服务端
      </span>
      <button
        className="rounded-full border border-line bg-panel px-2 py-1"
        type="button"
        onClick={async () => {
          const url = window.location.href;
          try {
            await navigator.clipboard.writeText(url);
          } catch {
            window.prompt("在另一台设备打开这个地址：", url);
          }
        }}
      >
        跨设备接续
      </button>
    </div>
  );
}

export function PageBody({ kicker, title, children }: { kicker?: string; title: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-2 lg:px-8">
      <StatusBar />
      <div className="mb-5">
        {kicker ? <div className="kicker">{kicker}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}
