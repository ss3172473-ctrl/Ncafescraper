import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Naver Cafe Scraper",
  description: "네이버 카페 글 스크랩 작업 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
