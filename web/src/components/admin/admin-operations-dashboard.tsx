import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  ListChecks,
  Sparkles,
  Users,
} from "lucide-react";

import { AdminActionsPanel } from "@/components/admin/admin-actions-panel";
import type { AdminActorRole, AdminOperationsSnapshot, AdminOperationsState } from "@/lib/admin/operations";
import type { AdminRoleChangeRequest, AdminSuperAdminBootstrapStatus } from "@/lib/admin/operations-contract";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";

function getStateLabel(state: AdminOperationsState): string {
  if (state === "healthy") return "Đang ổn định";
  if (state === "degraded") return "Cần để ý";
  return "Chưa sẵn sàng";
}

function getStateTone(state: AdminOperationsState): "success" | "warning" | "error" {
  if (state === "healthy") return "success";
  return state === "degraded" ? "warning" : "error";
}

function getStateClasses(state: AdminOperationsState): string {
  if (state === "healthy") return "border-success-100 bg-success-50/70";
  if (state === "degraded") return "border-warning-100 bg-warning-50/70";
  return "border-error-100 bg-error-50/70";
}

function getFailureLabel(code: string): string {
  if (code === "PROVIDER_TIMEOUT") return "Một dịch vụ bên ngoài phản hồi chậm";
  return "Một nhóm tác vụ cần được xem lại";
}

function formatCount(value: number): string {
  return value.toLocaleString("vi-VN");
}

function SummaryMetric({
  label,
  value,
  helper,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  tone: "brand" | "success" | "review";
  icon: typeof Activity;
}): React.ReactNode {
  const toneClasses = {
    brand: "border-brand-100 bg-brand-50/70 text-brand-700",
    success: "border-success-100 bg-success-50/70 text-success-700",
    review: "border-review-100 bg-review-50/70 text-review-600",
  }[tone];

  return (
    <div className={cn("rounded-3xl border p-4", toneClasses)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
      <p className="mt-1 text-sm leading-5 text-ink-600">{helper}</p>
    </div>
  );
}

function StatusCard({
  label,
  state,
  description,
  icon: Icon,
}: {
  label: string;
  state: AdminOperationsState;
  description: string;
  icon: typeof Activity;
}): React.ReactNode {
  return (
    <article className={cn("rounded-3xl border p-5", getStateClasses(state))}>
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-ink-700 shadow-sm">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink-900">{label}</h3>
            <Badge tone={getStateTone(state)}>{getStateLabel(state)}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
        </div>
      </div>
    </article>
  );
}

function MockInsightCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof Users;
}): React.ReactNode {
  return (
    <article className="rounded-3xl border border-ink-200 bg-white/80 p-4">
      <div className="flex items-center gap-3 text-ink-500">
        <Icon className="h-4 w-4" aria-hidden />
        <p className="text-sm font-medium">{label}</p>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      <p className="mt-1 text-sm leading-5 text-ink-600">{helper}</p>
    </article>
  );
}

export function AdminOperationsDashboard({
  snapshot,
  actorRole,
  roleChangeRequests,
  roleChangeRequestsAvailable,
  superAdminStatus,
}: {
  snapshot: AdminOperationsSnapshot;
  actorRole: AdminActorRole | null;
  roleChangeRequests: readonly AdminRoleChangeRequest[];
  roleChangeRequestsAvailable: boolean;
  superAdminStatus: AdminSuperAdminBootstrapStatus | null;
}): React.ReactNode {
  const pendingWork = snapshot.jobs.pending + snapshot.jobs.running;
  const failureCount = snapshot.failures.reduce((total, failure) => total + failure.count, 0);
  const attentionCount = failureCount + roleChangeRequests.length;
  const processingStatus = snapshot.resources[0]?.status ?? "unavailable";
  const isHealthy = snapshot.health === "healthy" && snapshot.readiness === "healthy";

  return (
    <div className="space-y-6 text-ink-900">
      <section className="relative overflow-hidden rounded-[2rem] border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-review-50/70 p-6 sm:p-8">
        <Sparkles className="absolute -right-4 -top-5 h-32 w-32 rotate-12 text-brand-100/70" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
          <div className="max-w-2xl">
            <Badge tone="brand">Tổng quan quản trị</Badge>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
              {isHealthy ? "Mọi thứ đang chạy đúng nhịp" : "Có vài việc cần bạn để ý"}
            </h2>
            <p className="mt-3 text-base leading-7 text-ink-600">
              Xem nhanh tình hình chung, xử lý việc cần ưu tiên và giữ trải nghiệm học tập luôn thông suốt.
            </p>
          </div>
          <div className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-[0_12px_30px_rgba(64,55,47,0.08)]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-success-50 text-success-700">
                {isHealthy ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <CircleAlert className="h-5 w-5" aria-hidden />}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Tình hình chung</p>
                <p className="mt-0.5 text-sm text-ink-600">{isHealthy ? "Đang ổn định" : "Cần theo dõi thêm"}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-600">
              {attentionCount === 0 ? "Hiện chưa có mục nào cần bạn xử lý." : `${formatCount(attentionCount)} mục đang chờ được xem.`}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="admin-overview-metrics">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Bức tranh hôm nay</p>
            <h2 id="admin-overview-metrics" className="mt-1 text-xl font-semibold tracking-tight text-ink-900">
              Những con số giúp bạn chọn việc tiếp theo
            </h2>
          </div>
          <span className="inline-flex items-center gap-2 text-sm text-ink-500">
            <Clock3 className="h-4 w-4" aria-hidden />
            Cập nhật khi tải lại trang
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryMetric label="Việc đang chờ" value={formatCount(pendingWork)} helper="Đang chờ hoặc đang được xử lý" tone="review" icon={Clock3} />
          <SummaryMetric label="Đã hoàn tất" value={formatCount(snapshot.jobs.completed)} helper="Tác vụ đã xử lý xong" tone="success" icon={ListChecks} />
          <SummaryMetric label="Cần xem" value={formatCount(attentionCount)} helper="Lỗi hoặc yêu cầu quyền truy cập" tone="brand" icon={CircleAlert} />
        </div>
      </section>

      <section aria-labelledby="admin-status-heading" className="rounded-[2rem] border border-ink-200 bg-white/80 p-5 sm:p-6">
        <div className="mb-5">
          <p className="text-sm font-semibold text-brand-700">Theo dõi nền tảng</p>
          <h2 id="admin-status-heading" className="mt-1 text-xl font-semibold tracking-tight text-ink-900">
            Các phần quan trọng vẫn đang hoạt động
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
            Chỉ giữ lại thông tin giúp bạn quyết định nhanh.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <StatusCard label="Toàn bộ nền tảng" state={snapshot.health} description={snapshot.health === "healthy" ? "Các chức năng chính đang phản hồi bình thường." : "Một số chức năng có thể cần được kiểm tra thêm."} icon={Activity} />
          <StatusCard label="Xử lý tài liệu" state={processingStatus} description={processingStatus === "healthy" ? "Tài liệu có thể tiếp tục được xử lý." : "Tài liệu có thể chờ lâu hơn bình thường."} icon={FileText} />
        </div>
      </section>

      <section aria-labelledby="admin-attention-heading" className="rounded-[2rem] border border-ink-200 bg-white/80 p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Việc cần xem</p>
            <h2 id="admin-attention-heading" className="mt-1 text-xl font-semibold tracking-tight text-ink-900">
              Giữ mọi thứ đi đúng hướng
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-600">Chỉ hiển thị mô tả đủ để bạn quyết định bước tiếp theo.</p>
          </div>
          <Badge tone={attentionCount === 0 ? "success" : "warning"}>
            {attentionCount === 0 ? "Không có việc gấp" : `${formatCount(attentionCount)} mục cần xem`}
          </Badge>
        </div>
        {snapshot.failures.length === 0 ? (
          <div className="flex items-start gap-3 rounded-3xl border border-success-100 bg-success-50/70 p-4 text-sm leading-6 text-ink-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-700" aria-hidden />
            <p>
              {roleChangeRequests.length === 0
                ? "Chưa có nhóm lỗi nào được ghi nhận. Bạn có thể tiếp tục theo dõi các tác vụ trong ngày."
                : `${formatCount(roleChangeRequests.length)} yêu cầu quyền truy cập đang chờ bạn xem ở phần quản lý bên dưới.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {snapshot.failures.map((failure) => (
                <div key={failure.code} className="flex items-center justify-between gap-4 rounded-3xl border border-warning-100 bg-warning-50/70 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <CircleAlert className="h-5 w-5 shrink-0 text-warning-700" aria-hidden />
                    <span className="text-sm text-ink-700">{getFailureLabel(failure.code)}</span>
                  </div>
                  <strong className="text-lg text-ink-900">{formatCount(failure.count)}</strong>
                </div>
              ))}
            </div>
            {roleChangeRequests.length > 0 ? (
              <p className="rounded-3xl border border-brand-100 bg-brand-50/70 p-4 text-sm leading-6 text-ink-700">
                {formatCount(roleChangeRequests.length)} yêu cầu quyền truy cập đang chờ bạn xem ở phần quản lý bên dưới.
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section aria-labelledby="admin-sample-heading" className="rounded-[2rem] border border-dashed border-brand-200 bg-brand-50/50 p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Góc nhìn mở rộng</p>
            <h2 id="admin-sample-heading" className="mt-1 text-xl font-semibold tracking-tight text-ink-900">
              Những chỉ số sẽ giúp bạn nhìn rõ hơn
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
              Các thẻ dưới đây là mẫu giao diện. Chúng sẽ dùng dữ liệu thật khi phần thống kê được kết nối.
            </p>
          </div>
          <Badge tone="brand">Dữ liệu minh họa</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MockInsightCard label="Người học hôm nay" value="128" helper="Tài khoản đang học trong ngày" icon={Users} />
          <MockInsightCard label="Tài liệu mới" value="42" helper="Tài liệu được thêm trong tuần" icon={FileText} />
          <MockInsightCard label="Mức hoàn thành" value="86%" helper="Mục tiêu học tập trong tuần" icon={ArrowUpRight} />
        </div>
      </section>

      <AdminActionsPanel actorRole={actorRole} initialRoleChangeRequests={roleChangeRequests} roleChangeRequestsAvailable={roleChangeRequestsAvailable} superAdminStatus={superAdminStatus} />
    </div>
  );
}
