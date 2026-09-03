"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, CircleAlert, MoreHorizontal, Sparkles, X } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { learnerBottomNav, learnerPrimaryNav, learnerSecondaryNav } from "@/lib/nav";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui";

function isLearnerRouteActive(pathname: string, href: string) {
  return pathname === href || (href !== routes.home && pathname.startsWith(`${href}/`));
}

function NavLink({
  href,
  label,
  icon: Icon,
  activePathname,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activePathname: string;
  onNavigate: (href: string) => void;
}) {
  const active = isLearnerRouteActive(activePathname, href);
  return (
    <Link
      href={href}
      onNavigate={() => onNavigate(href)}
      className={cn(
        "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        active ? "bg-brand-600 text-white shadow-[0_8px_18px_rgba(216,79,56,0.2)]" : "text-ink-600 hover:bg-brand-50 hover:text-brand-800",
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
  const [pendingNavigation, setPendingNavigation] = useState<{ from: string; to: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPhase0Route = isPhase0LearnerRoute(pathname);
  const showDemoLabel = !isPhase0Route;
  const pendingPathname = pendingNavigation?.from === pathname ? pendingNavigation.to : null;
  const activePathname = pendingPathname ?? pathname;
  const isPersonalRoute = learnerSecondaryNav.some(({ href }) => isLearnerRouteActive(activePathname, href));
  const isNavigationPending = pendingPathname !== null;

  function handleNavigate(href: string) {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }

    if (href === pathname) {
      setPendingNavigation(null);
      return;
    }

    setPendingNavigation({ from: pathname, to: href });
    // A failed or interrupted transition must not leave the previous screen marked as pending forever.
    navigationTimeoutRef.current = setTimeout(() => {
      setPendingNavigation((current) => {
        if (current?.from === pathname && current.to === href) {
          return null;
        }
        return current;
      });
      navigationTimeoutRef.current = null;
    }, 10000);
  }

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const firstLink = mobileMenuRef.current?.querySelector<HTMLAnchorElement>("a[href]");
    firstLink?.focus();

    function handleMenuKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
        mobileMenuTriggerRef.current?.focus();
        return;
      }

      if (event.key !== "Tab") return;
      const focusableItems = mobileMenuRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!focusableItems?.length) return;

      const firstItem = focusableItems[0];
      const lastItem = focusableItems[focusableItems.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", handleMenuKeyDown);
    return () => document.removeEventListener("keydown", handleMenuKeyDown);
  }, [isMobileMenuOpen]);

  function closeMobileMenu() {
    setIsMobileMenuOpen(false);
    mobileMenuTriggerRef.current?.focus();
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex max-w-[1600px] gap-6 px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 lg:px-8 lg:pb-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 rounded-[2rem] border border-ink-200 bg-[#fffdf9]/90 p-4 shadow-[0_18px_50px_rgba(64,55,47,0.08)] lg:flex lg:flex-col">
          <Link href={routes.home} className="mb-8 flex items-center gap-3 px-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-[0_8px_16px_rgba(216,79,56,0.22)]">
              lp
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">LearningPlatform</p>
              <p className="text-xs text-ink-500">Bàn học của bạn</p>
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

          <nav aria-label="Điều hướng học tập" className="space-y-1">
            {learnerPrimaryNav.map((item) => (
              <NavLink
                key={item.href}
                {...item}
                activePathname={activePathname}
                onNavigate={handleNavigate}
              />
            ))}
          </nav>

          <div className="mt-6 border-t border-ink-100 pt-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
              Cá nhân
            </p>
            <div className="space-y-1">
              {learnerSecondaryNav.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  activePathname={activePathname}
                  onNavigate={handleNavigate}
                />
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
          {isNavigationPending ? (
            <div
              className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-1 bg-brand-100/80"
              role="status"
              aria-live="polite"
              aria-label="Đang mở trang"
            >
              <div className="h-full w-1/3 animate-pulse bg-brand-500" />
            </div>
          ) : null}
          <header className="mb-6 rounded-[2rem] border border-ink-200 bg-[#fffdf9]/90 px-4 py-4 shadow-[0_18px_50px_rgba(64,55,47,0.07)] sm:px-7 sm:py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
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
                <LogoutButton />
              </div>
            </div>
          </header>

          {children}
        </div>
      </div>

      {isMobileMenuOpen ? (
        <button
          type="button"
          aria-label="Đóng menu điều hướng"
          className="fixed inset-0 z-[45] bg-ink-900/20 lg:hidden"
          onClick={closeMobileMenu}
        />
      ) : null}

      {isMobileMenuOpen ? (
        <div
          ref={mobileMenuRef}
          id="mobile-learner-menu"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-learner-menu-title"
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-3xl border border-ink-200 bg-[#fffdf9] p-3 shadow-[0_18px_50px_rgba(64,55,47,0.18)] lg:hidden"
        >
          <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
            <div>
              <p id="mobile-learner-menu-title" className="text-sm font-semibold text-ink-900">Cá nhân</p>
              <p className="text-xs text-ink-500">Quản lý tài khoản và lựa chọn học tập</p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-600 transition-colors hover:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              aria-label="Đóng menu cá nhân"
              onClick={closeMobileMenu}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav aria-label="Điều hướng cá nhân" className="grid gap-1">
            {learnerSecondaryNav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onNavigate={() => handleNavigate(href)}
                aria-current={isLearnerRouteActive(activePathname, href) ? "page" : undefined}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                  isLearnerRouteActive(activePathname, href) ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-100",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      ) : null}

      <nav aria-hidden={isMobileMenuOpen} className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-2 py-2">
          {learnerBottomNav.map(({ href, label, icon: Icon }) => {
            const active = isLearnerRouteActive(activePathname, href);
            return (
              <Link
                key={href}
                href={href}
                onNavigate={() => handleNavigate(href)}
                tabIndex={isMobileMenuOpen ? -1 : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                  active ? "text-brand-700" : "text-ink-500",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            );
          })}
          <button
            ref={mobileMenuTriggerRef}
            type="button"
            aria-label="Mở thêm điều hướng"
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-learner-menu"
            tabIndex={isMobileMenuOpen ? -1 : undefined}
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
              isMobileMenuOpen || isPersonalRoute ? "text-brand-700" : "text-ink-500",
            )}
          >
            {isMobileMenuOpen ? <X className="h-4 w-4" /> : <MoreHorizontal className="h-4 w-4" />}
            <span>Thêm</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
