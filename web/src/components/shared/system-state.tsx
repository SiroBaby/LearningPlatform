import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { PublicShellContent } from "@/components/layout/public-shell-content";
import { Card, CardBody, LinkButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ReloadButton } from "./reload-button";

export interface SystemAction {
  label: string;
  href?: string;
  onClickLabel?: string;
}

export function buildSystemMetadata(
  title: string,
  description: string,
): Metadata {
  return { title, description };
}

export function SystemStatePage({
  badge,
  title,
  description,
  detail,
  icon,
  tone = "brand",
  primaryAction,
  secondaryAction,
  isAuthenticated = false,
}: {
  badge: string;
  title: string;
  description: string;
  detail?: string;
  icon: "warning" | "offline" | "access" | "error";
  tone?: "brand" | "warning" | "error" | "neutral";
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  isAuthenticated?: boolean;
}) {
  const Icon = {
    warning: AlertTriangle,
    offline: WifiOff,
    access: ShieldAlert,
    error: RefreshCw,
  }[icon];

  const toneClasses = {
    brand: "bg-brand-50 text-brand-700 border-brand-100",
    warning: "bg-warning-50 text-warning-700 border-warning-100",
    error: "bg-error-50 text-error-700 border-error-100",
    neutral: "bg-ink-100 text-ink-700 border-ink-200",
  }[tone];

  return (
    <PublicShellContent isAuthenticated={isAuthenticated}>
      <div className="mx-auto flex min-h-[calc(100vh-180px)] max-w-4xl items-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <CardBody className="space-y-6 p-6 sm:p-10">
              <div className="inline-flex items-center rounded-full border border-current/10 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">
                {badge}
              </div>
              <div className="space-y-4">
                <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl border", toneClasses)}>
                  <Icon className="h-7 w-7" />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
                    {title}
                  </h1>
                  <p className="mt-3 text-base leading-7 text-ink-600">{description}</p>
                  {detail ? <p className="mt-3 text-sm leading-6 text-ink-500">{detail}</p> : null}
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                {primaryAction}
                {secondaryAction}
              </div>
            </CardBody>

            <div className="border-t border-ink-100 bg-ink-50/80 p-6 sm:p-10 lg:border-l lg:border-t-0">
              <div className="rounded-3xl border border-ink-100 bg-white p-5 card-shadow">
                <p className="text-sm font-semibold text-ink-900">What you can do next</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-ink-600">
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                    Quay lại Home để tiếp tục review queue hoặc mở tài liệu đang sẵn sàng.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                    Nếu lỗi liên quan đến xử lý tài liệu, hãy kiểm tra upload status và phần credit estimate.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                    Trường hợp không đủ quyền hoặc tài liệu bị giới hạn theo plan, xem lại Billing / Usage để biết nguyên nhân cụ thể.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </PublicShellContent>
  );
}

export function HomeActions() {
  return (
    <>
      <LinkButton href="/home">
        Quay về Home
        <ArrowRight className="h-4 w-4" />
      </LinkButton>
      <ReloadButton />
    </>
  );
}

export function AccessActions() {
  return (
    <>
      <LinkButton href="/billing/upgrade">Xem options nâng cấp</LinkButton>
      <Link href="/home" className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900">
        Về Home
      </Link>
    </>
  );
}
