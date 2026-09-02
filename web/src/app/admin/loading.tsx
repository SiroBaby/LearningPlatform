import { AdminShell } from "@/components/layout";

export default function AdminLoading(): React.ReactNode {
  return <AdminShell title="Tổng quan quản trị" subtitle="Đang tải thông tin để bạn xem nhanh tình hình chung."><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite"><p className="sr-only">Đang tải thông tin quản trị</p>{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-3xl border border-ink-200 bg-white/70 motion-reduce:animate-none" />)}</div></AdminShell>;
}
