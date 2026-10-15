import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研迹 Trace · 让灵感留下轨迹",
  description:
    "一个安静的科研灵感空间。记录想法，连接 AI，回看思考发生的轨迹。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
