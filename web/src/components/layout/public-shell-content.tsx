"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { Button, LinkButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { publicNav } from "@/lib/nav";
import { routes } from "@/lib/routes";

interface PublicShellContentProps {
  readonly children: React.ReactNode;
  readonly isAuthenticated: boolean;
}

/** Contains the interactive responsive navigation after the server resolves session state. */
export function PublicShellContent({ children, isAuthenticated }: PublicShellContentProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open]);

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href={routes.landing} className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
              LP
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">LearningPlatform</p>
              <p className="text-xs text-ink-500">Học chủ động từ tài liệu của bạn</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {publicNav.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm font-medium text-ink-600 hover:text-ink-900">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {isAuthenticated ? (
              <>
                <Link href={routes.home} className="text-sm font-medium text-ink-600 hover:text-ink-900">
                  Về trang học
                </Link>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href={routes.login} className="text-sm font-medium text-ink-600 hover:text-ink-900">
                  Login
                </Link>
                <LinkButton href={routes.signup}>Start free</LinkButton>
              </>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            className="md:hidden"
            aria-label={open ? "Đóng menu" : "Mở menu"}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        <div className={cn("border-t border-ink-100 bg-white md:hidden", open ? "block" : "hidden")}>
          <nav className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 sm:px-6">
            {publicNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {isAuthenticated ? (
              <>
                <Link
                  href={routes.home}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
                  onClick={() => setOpen(false)}
                >
                  Về trang học
                </Link>
                <LogoutButton className="justify-center" />
              </>
            ) : (
              <>
                <Link
                  href={routes.login}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
                  onClick={() => setOpen(false)}
                >
                  Login
                </Link>
                <LinkButton href={routes.signup} className="justify-center" onClick={() => setOpen(false)}>
                  Start free
                </LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.3fr_1fr_1fr] lg:px-8">
          <div>
            <p className="text-base font-semibold text-ink-900">LearningPlatform</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-ink-600">
              Biến PDF, văn bản và video bài giảng thành quiz, checkpoint và kế hoạch ôn tập có trích dẫn nguồn.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-900">Sản phẩm</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li><Link href={routes.product}>Product</Link></li>
              <li><Link href={routes.examples}>Examples</Link></li>
              <li><Link href={routes.pricing}>Pricing</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-900">Niềm tin & trợ giúp</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li><Link href={routes.faq}>FAQ</Link></li>
              <li><Link href={routes.privacy}>Privacy Policy</Link></li>
              <li><Link href={routes.terms}>Terms</Link></li>
              <li><Link href={routes.billing}>Usage transparency</Link></li>
              <li>Uploaded documents are private by default.</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
