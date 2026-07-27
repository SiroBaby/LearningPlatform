"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    <div className="min-h-screen bg-ink-900 text-ink-50">
      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-72 shrink-0 rounded-[var(--radius-card)] border border-white/10 bg-ink-800 p-4 lg:block">
          <p className="px-2 text-lg font-semibold text-white">Admin / Operator</p>
          <nav className="mt-6 space-y-1">
            {adminNav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    active ? "bg-brand-500/20 text-brand-200" : "text-ink-300 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-white/10 bg-ink-800 p-4 sm:p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-ink-300">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
