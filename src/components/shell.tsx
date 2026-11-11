"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  Inbox,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  UsersRound,
} from "lucide-react";
import { MOBILE_NAV, SIDE_LINKS, isActive } from "@/lib/nav";

const icons = {
  "/": MessageCircle,
  "/team": UsersRound,
  "/work": BriefcaseBusiness,
  "/inbox": Inbox,
  "/settings": Settings2,
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const showXiaodian = !query.trim() || "小点".includes(query.trim());
  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${collapsed ? "is-collapsed" : ""}`}
        aria-label="主导航"
      >
        <div className="sidebar-brand">
          <Link href="/" className="brand" aria-label="OpenDot 首页">
            <span className="brand-mark">
              <DotFace />
            </span>
            <span className="sidebar-label">OpenDot</span>
          </Link>
          <button
            className="icon-button collapse-button"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        {!collapsed && (
          <label className="sidebar-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Dot"
              aria-label="搜索 Dot"
            />
          </label>
        )}
        <div className="sidebar-content">
          <div className="section-label sidebar-label">我的助手</div>
          {showXiaodian ? (
            <Link
              href="/c/xiaodian"
              className="dot-link"
              data-active={isActive("/", pathname)}
              aria-label="与小点对话"
            >
              <DotFace />
              <span className="sidebar-label">
                <strong>小点</strong>
                <small>你的个人助手</small>
              </span>
            </Link>
          ) : (
            <p className="search-empty">没有匹配的 Dot</p>
          )}
          <Link
            href="/team"
            className="nav-btn team-link"
            data-active={pathname === "/team"}
            title="我的 Dot"
          >
            <UsersRound size={18} />
            <span className="sidebar-label">我的 Dot</span>
          </Link>
          <div className="sidebar-divider" />
          <div className="section-label sidebar-label">对话</div>
          <Link href="/c/xiaodian" className="nav-btn" title="与小点的对话">
            <MessageCircle size={18} />
            <span className="sidebar-label">与小点的对话</span>
          </Link>
        </div>
        <div className="sidebar-bottom">
          {SIDE_LINKS.map((item) => {
            const Icon = icons[item.href as keyof typeof icons];
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-btn"
                data-active={isActive(item.href, pathname)}
                title={item.label}
              >
                <Icon size={18} />
                <span className="sidebar-label">{item.label}</span>
              </Link>
            );
          })}
          <Link
            href="/settings"
            className="profile-link"
            aria-label="个人空间设置"
          >
            <span className="profile-avatar">我</span>
            <span className="sidebar-label">
              <strong>个人空间</strong>
              <small>自托管 OpenDot</small>
            </span>
            <ChevronRight className="sidebar-label" size={16} />
          </Link>
        </div>
      </aside>
      <div className="app-content">
        <div className="app-page">{children}</div>
        <nav
          className={`mobile-nav ${pathname.startsWith("/c/") ? "in-conversation" : ""}`}
          aria-label="主导航"
        >
          {MOBILE_NAV.map((item) => {
            const Icon = icons[item.href as keyof typeof icons];
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={isActive(
                  item.href,
                  pathname,
                  item.href === "/work",
                )}
              >
                <Icon size={21} strokeWidth={1.7} />
                <span>{item.label}</span>
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
    <span className="dot-face" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export function PageBody({
  title,
  children,
}: {
  kicker?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page-scroll">
      <header className="page-toolbar">
        <Link href="/c/xiaodian" className="quiet-link">
          <MessageCircle size={16} />
          与小点对话
          <ArrowUpRight size={14} />
        </Link>
      </header>
      <main className="page-body">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
