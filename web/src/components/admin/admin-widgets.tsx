import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CircleAlert,
  FileWarning,
  LifeBuoy,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { Badge, BarChart, ProgressBar, TrendChart } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Job } from "@/lib/types";
import type {
  AdminMetricCardData,
  AdminSystemHealthItem,
  ModerationItem,
  OperationalAlert,
  SupportCase,
} from "./admin-data";

interface ToneDatum {
  label: string;
  value: number;
  tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
}

function getMetricToneClass(
  tone: AdminMetricCardData["tone"],
): string {
  if (tone === "success") return "border-success-400/30 bg-success-500/10 text-success-100";
  if (tone === "warning") return "border-warning-400/30 bg-warning-500/10 text-warning-100";
  if (tone === "error") return "border-error-400/30 bg-error-500/10 text-error-100";
  if (tone === "mastery") return "border-mastery-400/30 bg-mastery-500/10 text-mastery-100";
  if (tone === "review") return "border-review-400/30 bg-review-500/10 text-review-100";
  return "border-brand-400/30 bg-brand-500/10 text-brand-100";
}

function getJobStatusTone(status: Job["status"]): "brand" | "success" | "warning" | "error" {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "pending") return "warning";
  return "brand";
}

function getHealthToneClass(status: AdminSystemHealthItem["status"]): string {
  if (status === "healthy") return "border-success-400/20 bg-success-500/10 text-success-100";
  if (status === "degraded") return "border-error-400/20 bg-error-500/10 text-error-100";
  return "border-warning-400/20 bg-warning-500/10 text-warning-100";
}

function getAlertToneClass(alert: OperationalAlert["tone"]): string {
  if (alert === "success") return "border-success-400/20 bg-success-500/10 text-success-100";
  if (alert === "warning") return "border-warning-400/20 bg-warning-500/10 text-warning-100";
  if (alert === "error") return "border-error-400/20 bg-error-500/10 text-error-100";
  return "border-brand-400/20 bg-brand-500/10 text-brand-100";
}

function getModerationToneClass(
  severity: ModerationItem["severity"],
): string {
  if (severity === "critical") return "border-error-400/25 bg-error-500/15 text-error-100";
  if (severity === "high") return "border-warning-400/25 bg-warning-500/15 text-warning-100";
  return "border-brand-400/25 bg-brand-500/15 text-brand-100";
}

function DarkPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink-300">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function LightChartSurface({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white p-4">{children}</div>;
}

export function AdminMetricGrid({
  items,
}: {
  items: readonly AdminMetricCardData[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "rounded-[var(--radius-card)] border px-4 py-4",
            getMetricToneClass(item.tone),
          )}
        >
          <p className="text-sm font-medium text-white/80">{item.label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {item.value}
          </p>
          <p className="mt-2 text-sm leading-6 text-white/70">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

export function AdminAlertList({
  alerts,
}: {
  alerts: readonly OperationalAlert[];
}) {
  return (
    <DarkPanel
      title="Operational alerts"
      description="Ưu tiên các tín hiệu bạn nên phản ứng trong 1–2 giờ tới."
    >
      <div className="space-y-3">
        {alerts.map((alert) => (
          <Link
            key={alert.id}
            href={alert.href}
            className={cn(
              "block rounded-2xl border px-4 py-4 transition-colors hover:border-white/20 hover:bg-white/10",
              getAlertToneClass(alert.tone),
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">{alert.title}</p>
                <p className="mt-1 text-sm leading-6 text-white/80">{alert.detail}</p>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-white/60" aria-hidden />
            </div>
          </Link>
        ))}
      </div>
    </DarkPanel>
  );
}

export function AdminJobsOverview({
  jobs,
}: {
  jobs: readonly Job[];
}) {
  return (
    <DarkPanel
      title="Job monitoring snapshot"
      description="Danh sách rút gọn để operator thấy pipeline step, owner, cost estimate và lỗi gần nhất."
      action={
        <Link
          href={routes.adminJobs}
          className="text-sm font-medium text-brand-200 hover:text-brand-100"
        >
          Mở job monitor
        </Link>
      }
    >
      <div className="space-y-3">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={getJobStatusTone(job.status)}>{job.status}</Badge>
                  <span className="text-xs text-ink-400">{job.correlationId}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-white">{job.documentTitle}</p>
                <p className="mt-1 text-sm text-ink-300">
                  owner {job.owner} · step {job.step}
                </p>
              </div>
              <div className="text-sm text-ink-300">
                <p>Cost estimate {job.costEstimate}</p>
                {job.errorReason ? (
                  <p className="mt-1 max-w-md text-error-200">{job.errorReason}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </DarkPanel>
  );
}

export function AdminCostPanel({
  title,
  description,
  data,
  summary,
  mode,
  action,
}: {
  title: string;
  description: string;
  data: readonly ToneDatum[];
  summary: string;
  mode: "bar" | "trend";
  action?: React.ReactNode;
}) {
  return (
    <DarkPanel title={title} description={description} action={action}>
      <LightChartSurface>
        {mode === "bar" ? (
          <BarChart data={data} summary={summary} />
        ) : (
          <TrendChart data={data} summary={summary} />
        )}
      </LightChartSurface>
      <p className="mt-4 text-sm leading-6 text-ink-300">{summary}</p>
    </DarkPanel>
  );
}

export function AdminSystemHealthPanel({
  items,
}: {
  items: readonly AdminSystemHealthItem[];
}) {
  return (
    <DarkPanel
      title="System health"
      description="Tóm tắt nhanh các subsystem quan trọng để không phải mở quá nhiều màn hình."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "rounded-2xl border px-4 py-4",
              getHealthToneClass(item.status),
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{item.name}</p>
              <Badge tone="neutral">{item.status}</Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/80">{item.detail}</p>
          </div>
        ))}
      </div>
    </DarkPanel>
  );
}

export function AdminSupportPreview({
  cases,
}: {
  cases: readonly SupportCase[];
}) {
  return (
    <DarkPanel
      title="Support queue"
      description="Kết hợp user lookup, billing status và audit trail để agent hỗ trợ xử lý ít click hơn."
      action={
        <Link
          href={routes.adminSupport}
          className="text-sm font-medium text-brand-200 hover:text-brand-100"
        >
          Mở support view
        </Link>
      }
    >
      <div className="space-y-3">
        {cases.slice(0, 3).map((supportCase) => (
          <div
            key={supportCase.id}
            className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={supportCase.priority === "high" ? "error" : supportCase.priority === "medium" ? "warning" : "neutral"}>
                    {supportCase.priority}
                  </Badge>
                  <span className="text-xs text-ink-400">{supportCase.billingStatus}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-white">
                  {supportCase.userName} · {supportCase.userEmail}
                </p>
                <p className="mt-1 text-sm leading-6 text-ink-300">{supportCase.issue}</p>
              </div>
              <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-brand-200" aria-hidden />
            </div>
          </div>
        ))}
      </div>
    </DarkPanel>
  );
}

export function AdminModerationPreview({
  items,
}: {
  items: readonly ModerationItem[];
}) {
  return (
    <DarkPanel
      title="Moderation queue"
      description="Flagged files, suspicious usage và restrictions cần được operator nhìn thấy ngay từ overview."
      action={
        <Link
          href={routes.adminModeration}
          className="text-sm font-medium text-brand-200 hover:text-brand-100"
        >
          Mở moderation view
        </Link>
      }
    >
      <div className="space-y-3">
        {items.slice(0, 3).map((item) => (
          <div
            key={item.id}
            className={cn(
              "rounded-2xl border px-4 py-4",
              getModerationToneClass(item.severity),
            )}
          >
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <Badge tone="neutral">{item.status}</Badge>
                </div>
                <p className="mt-1 text-sm leading-6 text-white/80">{item.reason}</p>
                <p className="mt-2 text-xs text-white/60">
                  {item.owner} · {formatDateTime(item.createdAt)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </DarkPanel>
  );
}

export function AdminTopDocumentsPanel({
  items,
}: {
  items: readonly {
    id: string;
    title: string;
    owner: string;
    estimatedCost: string;
    reason: string;
  }[];
}) {
  return (
    <DarkPanel
      title="Top expensive documents"
      description="Các tài liệu tốn chi phí nhất để operator tìm ra pattern regenerate, STT hoặc tutor usage bất thường."
      action={
        <Link
          href={routes.adminCost}
          className="text-sm font-medium text-brand-200 hover:text-brand-100"
        >
          Xem cost dashboard
        </Link>
      }
    >
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm text-ink-300">owner {item.owner}</p>
                <p className="mt-2 text-sm leading-6 text-ink-300">{item.reason}</p>
              </div>
              <div className="rounded-full border border-review-400/25 bg-review-500/15 px-3 py-1 text-sm font-semibold text-review-100">
                {item.estimatedCost}
              </div>
            </div>
          </div>
        ))}
      </div>
    </DarkPanel>
  );
}

export function AdminCircuitBreakerPanel() {
  return (
    <DarkPanel
      title="Circuit breaker & spend guardrails"
      description="Tín hiệu an toàn để tránh runaway cost khi provider chậm hoặc lỗi."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-brand-400/20 bg-brand-500/10 px-4 py-4">
          <div className="flex items-center gap-2 text-brand-100">
            <Workflow className="h-4 w-4" aria-hidden />
            <p className="text-sm font-semibold">Circuit breaker</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">Closed</p>
          <p className="mt-2 text-sm text-white/70">Không có provider nào bị trip trong 24h qua.</p>
        </div>
        <div className="rounded-2xl border border-warning-400/20 bg-warning-500/10 px-4 py-4">
          <div className="flex items-center gap-2 text-warning-100">
            <BadgeDollarSign className="h-4 w-4" aria-hidden />
            <p className="text-sm font-semibold">Daily spend guard</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">61%</p>
          <div className="mt-3">
            <ProgressBar value={61} tone="warning" className="bg-white/10" />
          </div>
          <p className="mt-2 text-sm text-white/70">Đang trong ngưỡng an toàn nhưng cần theo dõi job retry buổi chiều.</p>
        </div>
        <div className="rounded-2xl border border-error-400/20 bg-error-500/10 px-4 py-4">
          <div className="flex items-center gap-2 text-error-100">
            <CircleAlert className="h-4 w-4" aria-hidden />
            <p className="text-sm font-semibold">Retry waste</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-white">12%</p>
          <p className="mt-2 text-sm text-white/70">Chủ yếu đến từ extract fail rồi regenerate quiz ngay sau đó.</p>
        </div>
      </div>
    </DarkPanel>
  );
}

export function AdminModerationRisksPanel() {
  return (
    <DarkPanel
      title="Risk checklist"
      description="Những tín hiệu operator cần kiểm tra trước khi cho phép user retry hoặc bỏ restriction."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4 text-sm text-ink-300">
          <div className="flex items-center gap-2 text-white">
            <FileWarning className="h-4 w-4" aria-hidden />
            <p className="font-semibold">Flagged files</p>
          </div>
          <p className="mt-2 leading-6">Verify loại tệp, kích thước và lý do verify fail trước khi cho upload lại.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4 text-sm text-ink-300">
          <div className="flex items-center gap-2 text-white">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <p className="font-semibold">Suspicious usage</p>
          </div>
          <p className="mt-2 leading-6">So sánh pattern prompt injection, retry spam và biến động credits theo user/document.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4 text-sm text-ink-300">
          <div className="flex items-center gap-2 text-white">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            <p className="font-semibold">Restrictions</p>
          </div>
          <p className="mt-2 leading-6">Ghi rõ audit log và scope restriction để support team không vô tình mở quá rộng.</p>
        </div>
      </div>
    </DarkPanel>
  );
}
