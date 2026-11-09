export interface NavItem {
  href: string;
  label: string;
}

export const MOBILE_NAV: NavItem[] = [
  { href: "/", label: "小点" },
  { href: "/team", label: "团队" },
  { href: "/work", label: "工作" },
  { href: "/settings", label: "设置" },
];

export const SIDE_LINKS: NavItem[] = [
  { href: "/work", label: "我的工作" },
  { href: "/inbox", label: "需要你处理" },
  { href: "/settings", label: "设置" },
];

export function isActive(href: string, pathname: string, includeInbox = false): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/c/");
  if (href === "/work" && includeInbox) return pathname.startsWith("/work") || pathname.startsWith("/inbox");
  return pathname === href || pathname.startsWith(`${href}/`);
}
