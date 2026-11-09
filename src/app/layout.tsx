import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenDot",
  description: "自托管个人 AI 助手与团队",
  applicationName: "OpenDot",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#efeff2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
