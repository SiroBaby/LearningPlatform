"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CircleCheck, ShieldCheck } from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { adminNav } from "@/lib/nav";
import { cn } from "@/lib/cn";

export function AdminShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      <div className="mx-auto flex max-w-[1600px] gap-6 px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 lg:px-8 lg:pb-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 flex-col rounded-[2rem] border border-ink-200 bg-[#fffdf9]/90 p-4 shadow-[0_18px_50px_rgba(64,55,47,0.08)] lg:flex">
          <Link href="/admin" className="mb-8 flex items-center gap-3 px-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-[0_8px_16px_rgba(216,79,56,0.22)]">
              lp
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink-900">LearningPlatform</span>
              <span className="block text-xs text-ink-500">Không gian quản trị</span>
            </span>
          </Link>

          <div className="mb-5 rounded-2xl bg-brand-50 p-3">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-brand-700">Quản trị có trách nhiệm</p>
                <p className="mt-1 text-xs leading-5 text-brand-700/90">
                  Mỗi thay đổi quan trọng đều cần được xem kỹ.
                </p>
              </div>
            </div>
          </div>

          <nav aria-label="Điều hướng quản trị" className="space-y-1">
            {adminNav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                    active ? "bg-brand-600 text-white shadow-[0_8px_18px_rgba(216,79,56,0.2)]" : "text-ink-600 hover:bg-brand-50 hover:text-brand-800",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-success-100 bg-success-50/70 p-4">
            <div className="flex items-start gap-2">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-700" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-success-700">Mọi thứ trong tầm mắt</p>
                <p className="mt-1 text-xs leading-5 text-success-700/90">
                  Bắt đầu từ tổng quan, sau đó mở đúng phần bạn cần.
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-6 rounded-[2rem] border border-ink-200 bg-[#fffdf9]/90 px-4 py-4 shadow-[0_18px_50px_rgba(64,55,47,0.07)] sm:px-7 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-brand-700">Không gian quản trị</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
                {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-600 sm:text-base">{subtitle}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-ink-500">Xem thông tin, chọn việc, xử lý cẩn trọng.</p>
                <LogoutButton />
              </div>
            </div>
          </header>
          {children}
        </main>
      </div>

      <nav aria-label="Điều hướng quản trị trên điện thoại" className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1 px-2 py-2">
          {adminNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-center text-[10px] font-medium leading-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                  active ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-100",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
