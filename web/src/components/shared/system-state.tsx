import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { PublicShellContent } from "@/components/layout/public-shell-content";
import { Card, CardBody, LinkButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getHomeHref } from "./system-state-view";
import type { SessionVisibility } from "./system-state-view";
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
  icon,
  tone = "brand",
  primaryAction,
  secondaryAction,
  isAuthenticated,
}: {
  badge: string;
  title: string;
  description: string;
  icon: "warning" | "offline" | "access" | "error";
  tone?: "brand" | "warning" | "error" | "neutral";
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /** Required: `null` means the session is unknown, so account actions stay hidden instead of defaulting to guest. */
  isAuthenticated: SessionVisibility;
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
      <div className="mx-auto flex min-h-[calc(100vh-180px)] max-w-2xl items-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full overflow-hidden">
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
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              {primaryAction}
              {secondaryAction}
            </div>
          </CardBody>
        </Card>
      </div>
    </PublicShellContent>
  );
}

export function HomeActions({
  isAuthenticated,
  canRetry = true,
}: {
  isAuthenticated: SessionVisibility;
  canRetry?: boolean;
}) {
  return (
    <>
      <LinkButton href={getHomeHref(isAuthenticated)}>
        Về trang chủ
        <ArrowRight className="h-4 w-4" />
      </LinkButton>
      {canRetry ? <ReloadButton /> : null}
    </>
  );
}
