"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CircleAlert, Sparkles } from "lucide-react";
import { learnerBottomNav, learnerPrimaryNav, learnerSecondaryNav } from "@/lib/nav";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/ui";

function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== routes.home && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}

const PHASE_0_ROUTE_MATCHERS = [
  routes.upload,
  routes.library,
  "/processing",
  "/quiz",
] as const;

function isPhase0LearnerRoute(pathname: string) {
  return PHASE_0_ROUTE_MATCHERS.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function LearnerShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPhase0Route = isPhase0LearnerRoute(pathname);
  const showDemoLabel = !isPhase0Route;

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-72 shrink-0 rounded-[var(--radius-card)] border border-ink-200 bg-white p-4 card-shadow lg:flex lg:flex-col">
          <Link href={routes.home} className="mb-6 flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 font-bold text-white">
              LP
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">LearningPlatform</p>
              <p className="text-xs text-ink-500">Góc học tập</p>
            </div>
          </Link>

          {showDemoLabel ? (
            <div className="mb-4 rounded-2xl bg-brand-50 p-3">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 text-brand-600" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-brand-700">Dữ liệu minh họa</p>
                  <p className="text-sm text-brand-700/90">
                    Nội dung trên trang này chỉ dùng để minh hoạ trải nghiệm.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <nav className="space-y-1">
            {learnerPrimaryNav.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>

          <div className="mt-6 border-t border-ink-100 pt-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
              Tài khoản
            </p>
            <div className="space-y-1">
              {learnerSecondaryNav.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </div>

          {showDemoLabel ? (
            <div className="mt-auto rounded-2xl border border-warning-200 bg-warning-50 p-4">
              <div className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 text-warning-700" />
                <div>
                  <p className="text-sm font-semibold text-warning-800">Dữ liệu minh họa</p>
                  <p className="mt-1 text-sm text-warning-800/90">
                    Thông tin trên trang này chỉ để xem trước, có thể khác dữ liệu bạn sẽ dùng sau này.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="mb-6 rounded-[var(--radius-card)] border border-ink-200 bg-white px-4 py-4 card-shadow sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
                  {showDemoLabel ? <Badge tone="brand">Dữ liệu minh họa</Badge> : null}
                </div>
                {subtitle ? (
                  <p className="mt-1 text-sm text-ink-600 sm:text-base">{subtitle}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {actions}
                <Link
                  href={routes.notifications}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                  aria-label="Thông báo"
                >
                  <Bell className="h-4 w-4" />
                </Link>
                <Button variant="outline">Cần hỗ trợ</Button>
              </div>
            </div>
          </header>

          {children}
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-2 py-2">
          {learnerBottomNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== routes.home && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium",
                  active ? "text-brand-700" : "text-ink-500",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
