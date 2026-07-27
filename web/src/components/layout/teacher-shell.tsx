"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { teacherNav } from "@/lib/nav";
import { cn } from "@/lib/cn";

export function TeacherShell({
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
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-72 shrink-0 rounded-card border border-ink-200 bg-white p-4 card-shadow lg:block">
          <p className="px-2 text-lg font-semibold text-ink-900">Teacher Workspace</p>
          <nav className="mt-6 space-y-1">
            {teacherNav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/teacher" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 rounded-card border border-ink-200 bg-white p-4 card-shadow sm:p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-ink-600">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
