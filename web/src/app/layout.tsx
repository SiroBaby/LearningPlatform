import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LearningPlatform — Học chủ động từ tài liệu của bạn",
    template: "%s · LearningPlatform",
  },
  description:
    "Biến PDF, văn bản, video bài giảng thành quiz, checkpoint và kế hoạch ôn tập cá nhân hóa với trích dẫn nguồn.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-(--background) text-ink-900">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
