"use client";

import { useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, KeyRound, RefreshCw, ShieldAlert, UserCog } from "lucide-react";

import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Dialog, SelectField, TextField, useToast } from "@/components/ui";
import { formatVietnameseDateTime, formatVietnameseMediumDate } from "@/lib/date-time";
import type { AdminActorRole } from "@/lib/admin/operations";
import {
  parseAdminRoleChangeRequestList,
  parseAdminSuperAdminBootstrapStatus,
  type AdminRoleChangeRequest,
  type AdminSuperAdminBootstrapStatus,
  type AdminSuperAdminMode,
} from "@/lib/admin/operations-contract";

type DesiredRole = "ADMIN" | "SUPER_ADMIN";
type PendingAction = "bootstrap" | "request" | "approve" | null;

const ADMIN_ACTION_TIMEOUT_MS = 15_000;

interface ActionFeedback {
  readonly tone: "success" | "error";
  readonly message: string;
  readonly detail?: string;
}

interface SafeErrorPayload {
  readonly code?: unknown;
  readonly requestId?: unknown;
  readonly completed?: unknown;
}

function isSafeErrorPayload(value: unknown): value is SafeErrorPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(status: number, payload: unknown): string {
  const code = isSafeErrorPayload(payload) && typeof payload.code === "string" ? payload.code : null;
  if (code === "SESSION_INVALID" || status === 401) return "Phiên đăng nhập không còn hiệu lực.";
  if (code === "ADMIN_FORBIDDEN" || status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (code === "INVALID_REQUEST") return "Thông tin thao tác chưa đúng. Hãy kiểm tra lại mã đã nhập.";
  if (code === "ADMIN_ACTION_CONFLICT" || status === 409) {
    return "Thao tác hiện chưa thể thực hiện. Hãy kiểm tra điều kiện và thử lại.";
  }
  if (code === "ADMIN_BACKEND_UNAVAILABLE" || status >= 500) {
    return "Dịch vụ quản trị đang tạm thời chưa sẵn sàng. Hãy thử lại sau.";
  }
  return "Không thể thực hiện thao tác này. Hãy thử lại.";
}

async function readResponsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function roleLabel(role: DesiredRole): string {
  return role === "SUPER_ADMIN" ? "quản trị cấp cao" : "quản trị viên";
}

function actionTitle(action: Exclude<PendingAction, null>): string {
  if (action === "bootstrap") return "Xác nhận thiết lập quản trị ban đầu";
  if (action === "request") return "Xác nhận gửi yêu cầu đổi vai trò";
  return "Xác nhận duyệt yêu cầu";
}

function desiredRoleLabel(role: DesiredRole): string {
  return role === "SUPER_ADMIN" ? "Quản trị cấp cao" : "Quản trị viên";
}

function shortDate(isoDate: string): string {
  return formatVietnameseMediumDate(isoDate);
}

function modeLabel(mode: AdminSuperAdminMode): string {
  if (mode === "FIRST_BOOTSTRAP") return "Thiết lập ban đầu";
  if (mode === "SEED_SECOND") return "Hoàn thiện nhóm quản trị";
  if (mode === "NORMAL") return "Đang vận hành bình thường";
  if (mode === "QUORUM_RECOVERY") return "Cần khôi phục đủ người phê duyệt";
  return "Cần khôi phục quyền quản trị";
}

function modeDescription(mode: AdminSuperAdminMode): string {
  if (mode === "FIRST_BOOTSTRAP") {
    return "Chưa có quản trị cấp cao đang hoạt động. Người được chỉ định có thể thiết lập người đầu tiên.";
  }
  if (mode === "SEED_SECOND") {
    return "Đã có một quản trị cấp cao. Sau khi bước vận hành bên ngoài hoàn tất, một quản trị viên không tham gia phê duyệt có thể gửi yêu cầu để tạo đủ hai người phê duyệt.";
  }
  if (mode === "NORMAL") {
    return "Đã có đủ người phê duyệt. Mọi thay đổi quyền quan trọng cần hai người kiểm tra độc lập.";
  }
  if (mode === "QUORUM_RECOVERY") {
    return "Hệ thống chỉ còn một quản trị cấp cao sau khi đã từng có đủ người phê duyệt. Cần quy trình vận hành bên ngoài để khôi phục.";
  }
  return "Không còn quản trị cấp cao đang hoạt động. Chỉ quy trình khôi phục ở tầng vận hành mới có thể mở lại quyền quản trị.";
}

function modeTone(mode: AdminSuperAdminMode): "success" | "warning" | "error" | "brand" {
  if (mode === "NORMAL") return "success";
  if (mode === "LOCKOUT_RECOVERY") return "error";
  if (mode === "FIRST_BOOTSTRAP") return "brand";
  return "warning";
}

function expiryLabel(expiresAt: string | null): { label: string; expired: boolean } | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  const expired = expiry.getTime() <= Date.now();
  return {
    expired,
    label: expired
      ? "Đã hết hạn"
      : `Hết hạn ${formatVietnameseDateTime(expiresAt)}`,
  };
}

function isAbortError(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "name" in value
    && value.name === "AbortError";
}

export function AdminActionsPanel({
  actorRole,
  initialRoleChangeRequests,
  roleChangeRequestsAvailable,
  superAdminStatus,
}: {
  readonly actorRole: AdminActorRole | null;
  readonly initialRoleChangeRequests: readonly AdminRoleChangeRequest[];
  readonly roleChangeRequestsAvailable: boolean;
  readonly superAdminStatus: AdminSuperAdminBootstrapStatus | null;
}): React.ReactNode {
  const { notify } = useToast();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [desiredRole, setDesiredRole] = useState<DesiredRole>("SUPER_ADMIN");
  const [roleChangeRequests, setRoleChangeRequests] = useState<readonly AdminRoleChangeRequest[]>(initialRoleChangeRequests);
  const [selectedRequest, setSelectedRequest] = useState<AdminRoleChangeRequest | null>(null);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(roleChangeRequestsAvailable ? null : "Chưa thể tải danh sách yêu cầu.");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [currentSuperAdminStatus, setCurrentSuperAdminStatus] = useState<AdminSuperAdminBootstrapStatus | null>(superAdminStatus);
  const currentMode = currentSuperAdminStatus?.mode ?? null;
  const statusKnown = currentMode !== null;
  const canBootstrap = actorRole === "ADMIN" && currentMode === "FIRST_BOOTSTRAP";
  const canRequestRoleChange = (actorRole === "ADMIN" || actorRole === "SUPER_ADMIN")
    && currentMode === "NORMAL";

  async function refreshRoleChangeRequests(): Promise<void> {
    setIsLoadingRequests(true);
    setRequestsError(null);
    try {
      const response = await fetch("/api/admin/super-admin/role-change-requests?status=pending&limit=50", {
        cache: "no-store",
      });
      const payload = await readResponsePayload(response);
      if (!response.ok) {
        setRequestsError(errorMessage(response.status, payload));
        return;
      }
      const parsed = parseAdminRoleChangeRequestList(payload);
      if (!parsed) {
        setRequestsError("Dịch vụ quản trị trả về danh sách không hợp lệ.");
        return;
      }
      setRoleChangeRequests(parsed.items);
    } catch {
      setRequestsError("Không thể tải danh sách yêu cầu. Hãy thử lại sau.");
    } finally {
      setIsLoadingRequests(false);
    }
  }

  async function refreshSuperAdminStatus(): Promise<void> {
    try {
      const response = await fetch("/api/admin/super-admin/bootstrap/status", { cache: "no-store" });
      if (!response.ok) {
        setCurrentSuperAdminStatus(null);
        return;
      }
      const parsed = parseAdminSuperAdminBootstrapStatus(await readResponsePayload(response));
      setCurrentSuperAdminStatus(parsed);
    } catch {
      setCurrentSuperAdminStatus(null);
    }
  }

  function openAction(action: Exclude<PendingAction, null>): void {
    if (isSubmitting) return;
    setFeedback(null);
    if (action === "bootstrap" && !canBootstrap) {
      setFeedback({ tone: "error", message: "Thao tác thiết lập ban đầu không còn khả dụng." });
      return;
    }
    if (action === "request" && (!canRequestRoleChange || !targetUserId.trim())) {
      if (!canRequestRoleChange) {
        setFeedback({ tone: "error", message: "Chưa đủ điều kiện để gửi yêu cầu thay đổi quyền." });
        return;
      }
      setFeedback({ tone: "error", message: "Hãy nhập mã tài khoản cần thay đổi vai trò." });
      return;
    }
    setPendingAction(action);
  }

  function openApproval(request: AdminRoleChangeRequest): void {
    if (isSubmitting || !canRequestRoleChange) return;
    setFeedback(null);
    setSelectedRequest(request);
    setPendingAction("approve");
  }

  function closeConfirmation(): void {
    if (isSubmitting) return;
    setPendingAction(null);
    setSelectedRequest(null);
  }

  async function submitAction(): Promise<void> {
    if (!pendingAction || (pendingAction === "approve" && !selectedRequest)) return;
    setIsSubmitting(true);
    setFeedback(null);

    const config = pendingAction === "bootstrap"
      ? { path: "/api/admin/super-admin/bootstrap", body: undefined }
      : pendingAction === "request"
        ? {
            path: "/api/admin/super-admin/role-change-requests",
            body: { targetUserId: targetUserId.trim(), desiredRole },
          }
        : {
            path: "/api/admin/super-admin/role-change-approvals",
            body: { requestId: selectedRequest?.id ?? "" },
    };

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), ADMIN_ACTION_TIMEOUT_MS);
    try {
      const response = await fetch(config.path, {
        method: "POST",
        headers: config.body ? { "Content-Type": "application/json" } : undefined,
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: abortController.signal,
      });
      const payload = await readResponsePayload(response);
      if (!response.ok) {
        const message = errorMessage(response.status, payload);
        setFeedback({ tone: "error", message });
        notify(message, "error");
        return;
      }

      if (pendingAction === "bootstrap") {
        const message = "Đã thiết lập quản trị cấp cao đầu tiên.";
        setFeedback({
          tone: "success",
          message,
          detail: "Các phiên đăng nhập hiện tại của tài khoản được thiết lập sẽ bị thu hồi. Hãy đăng nhập lại nếu cần.",
        });
        notify(message, "success");
        await refreshSuperAdminStatus();
      } else if (pendingAction === "request") {
        const createdRequestId = isSafeErrorPayload(payload) && typeof payload.requestId === "string"
          ? payload.requestId
          : null;
        if (!createdRequestId) {
          const message = "Dịch vụ quản trị trả về kết quả không hợp lệ.";
          setFeedback({ tone: "error", message });
          notify(message, "error");
          return;
        }
        const message = "Đã gửi yêu cầu đổi vai trò.";
        setFeedback({ tone: "success", message, detail: "Bạn có thể theo dõi trạng thái ở danh sách bên dưới." });
        notify(message, "success");
        await refreshRoleChangeRequests();
      } else {
        const completed = isSafeErrorPayload(payload) && payload.completed === true;
        const message = completed ? "Đã đủ phê duyệt và hoàn tất thay đổi vai trò." : "Đã ghi nhận phê duyệt của bạn.";
        setFeedback({
          tone: "success",
          message,
          detail: completed ? "Thay đổi đã được áp dụng." : "Cần thêm một quản trị cấp cao khác phê duyệt độc lập.",
        });
        notify(message, "success");
        await refreshRoleChangeRequests();
        await refreshSuperAdminStatus();
      }
    } catch (error: unknown) {
      const message = isAbortError(error)
        ? "Thao tác mất quá nhiều thời gian. Hãy thử lại sau."
        : "Không thể kết nối đến dịch vụ quản trị. Hãy thử lại sau.";
      setFeedback({ tone: "error", message });
      notify(message, "error");
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
      setPendingAction(null);
      setSelectedRequest(null);
    }
  }

  return (
    <section className="rounded-[2rem] border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-review-50/50 p-5 sm:p-6" aria-labelledby="admin-actions-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand-700">
            <ShieldAlert className="h-5 w-5" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-[0.18em]">Quản lý quyền truy cập</p>
          </div>
          <h2 id="admin-actions-title" className="mt-2 text-xl font-semibold text-ink-900">Thao tác với quyền truy cập</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-600">
            Mọi thay đổi đều cần được kiểm tra và ghi lại rõ ràng.
          </p>
        </div>
        {actorRole ? (
          <span className="inline-flex w-fit rounded-full border border-brand-100 bg-white px-3 py-1 text-xs font-medium text-brand-700">
            Quyền hiện tại: {actorRole === "SUPER_ADMIN" ? "quản trị cấp cao" : "quản trị viên"}
          </span>
        ) : null}
      </div>

      {currentMode ? (
        <section className="mt-5 rounded-3xl border border-ink-200 bg-white/80 p-4 sm:p-5" aria-labelledby="admin-quorum-status-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <ShieldAlert className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="admin-quorum-status-title" className="text-sm font-semibold text-ink-900">Trạng thái quyền quản trị</h3>
                  <Badge tone={modeTone(currentMode)}>{modeLabel(currentMode)}</Badge>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600">{modeDescription(currentMode)}</p>
                {currentMode === "SEED_SECOND" ? (
                  <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink-500">
                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>Bước cấp quyền tạm thời được thực hiện qua quy trình vận hành đã được phê duyệt. Không nhập mã phê duyệt vào trang này.</span>
                  </p>
                ) : null}
                {currentMode === "QUORUM_RECOVERY" || currentMode === "LOCKOUT_RECOVERY" ? (
                  <p className="mt-3 text-xs leading-5 text-ink-500">
                    Hãy liên hệ người phụ trách vận hành để xác minh và mở quy trình khôi phục. Trang này không thể tự bỏ qua bước kiểm tra đó.
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void refreshSuperAdminStatus()}
              disabled={isSubmitting}
              aria-label="Cập nhật trạng thái quyền quản trị"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Cập nhật
            </Button>
          </div>
        </section>
      ) : (
        <div className="mt-5 flex items-start gap-3 rounded-3xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-700" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>Chưa thể xác định trạng thái quyền quản trị. Các thao tác thay đổi đang được tạm khóa để bảo vệ tài khoản.</p>
          <Button type="button" variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => void refreshSuperAdminStatus()} disabled={isSubmitting}>
            Thử lại
          </Button>
        </div>
      )}

      {!actorRole ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-700" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>Chưa xác định được quyền thao tác. Hãy tải lại trang trước khi thay đổi.</p>
        </div>
      ) : (
        <div className={`mt-6 grid gap-4 ${canBootstrap ? "xl:grid-cols-3" : "xl:grid-cols-1"}`}>
          {canBootstrap ? <Card className="border-ink-200 bg-white/85">
            <CardHeader>
              <div className="flex items-center gap-2 text-ink-900">
                <KeyRound className="h-5 w-5 text-brand-600" aria-hidden />
                <CardTitle>Thiết lập người quản trị đầu tiên</CardTitle>
              </div>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                Chỉ dùng một lần khi hệ thống chưa có quản trị cấp cao đang hoạt động.
              </p>
            </CardHeader>
            <CardBody>
              <Button type="button" variant="primary" className="w-full" onClick={() => openAction("bootstrap")}>
                Thiết lập quản trị cấp cao đầu tiên
              </Button>
            </CardBody>
          </Card> : null}

          <Card className={`border-ink-200 bg-white/85 ${!canRequestRoleChange ? "xl:col-span-full" : ""}`}>
            <CardHeader>
              <div className="flex items-center gap-2 text-ink-900">
                <UserCog className="h-5 w-5 text-brand-600" aria-hidden />
                <CardTitle>Đề xuất thay đổi quyền</CardTitle>
              </div>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                Gửi yêu cầu cấp hoặc thu hồi quyền cho một tài khoản đã tồn tại.
              </p>
            </CardHeader>
            <CardBody>
              {!statusKnown || currentMode === "FIRST_BOOTSTRAP" || currentMode === "SEED_SECOND" || currentMode === "QUORUM_RECOVERY" || currentMode === "LOCKOUT_RECOVERY" ? (
                <div className="mb-4 flex items-start gap-3 rounded-2xl border border-ink-100 bg-ink-50 p-3 text-sm leading-6 text-ink-600">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden />
                  <p>
                    {currentMode === "FIRST_BOOTSTRAP"
                      ? "Hãy thiết lập quản trị cấp cao đầu tiên trước khi gửi yêu cầu thay đổi quyền."
                      : currentMode === "SEED_SECOND"
                        ? "Hãy hoàn tất bước thiết lập nhóm quản trị bên ngoài trước khi gửi yêu cầu thay đổi quyền."
                      : currentMode === "QUORUM_RECOVERY" || currentMode === "LOCKOUT_RECOVERY"
                        ? "Các yêu cầu thay đổi quyền sẽ mở lại sau khi quy trình khôi phục hoàn tất."
                        : "Chưa thể mở thao tác khi trạng thái quyền quản trị chưa rõ ràng."}
                  </p>
                </div>
              ) : null}
              <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); openAction("request"); }}>
                <TextField
                  id="admin-target-user-id"
                  label="Mã tài khoản"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  hint="Dùng mã tài khoản của người cần thay đổi quyền."
                  value={targetUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  disabled={!canRequestRoleChange || isSubmitting}
                />
                <SelectField id="admin-desired-role" label="Quyền muốn cấp" value={desiredRole} onChange={(event) => setDesiredRole(event.target.value as DesiredRole)} disabled={!canRequestRoleChange || isSubmitting}>
                  <option value="SUPER_ADMIN">Quản trị cấp cao</option>
                  <option value="ADMIN">Quản trị viên</option>
                </SelectField>
                <Button type="submit" variant="secondary" className="w-full" disabled={!canRequestRoleChange || isSubmitting}>Gửi yêu cầu</Button>
              </form>
            </CardBody>
          </Card>

        </div>
      )}

      {actorRole ? (
          <Card className="mt-4 border-ink-200 bg-white/85">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                  <div className="flex items-center gap-2 text-ink-900">
                    <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden />
                    <CardTitle>Yêu cầu đang chờ xử lý</CardTitle>
                  </div>
                <p className="mt-1 text-sm leading-6 text-ink-600">
                  Cần hai quản trị cấp cao kiểm tra độc lập trước khi áp dụng.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void refreshRoleChangeRequests()} disabled={isLoadingRequests}>
                {isLoadingRequests ? "Đang tải…" : "Cập nhật danh sách"}
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {requestsError ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-700 sm:flex-row sm:items-center sm:justify-between" role="alert">
                <p>{requestsError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void refreshRoleChangeRequests()} disabled={isLoadingRequests}>Thử lại</Button>
              </div>
            ) : roleChangeRequests.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-ink-200 px-4 py-5 text-sm text-ink-600">
                Chưa có yêu cầu nào đang chờ xử lý.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {roleChangeRequests.map((request) => (
                  <article key={request.id} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
                    {(() => {
                      const expiry = expiryLabel(request.expiresAt);
                      return (
                        <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink-900">{desiredRoleLabel(request.desiredRole)}</p>
                        <p className="mt-1 text-xs text-ink-500">Tạo ngày {shortDate(request.createdAt)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                        {request.approvalCount}/{request.requiredApprovals} phê duyệt
                      </span>
                    </div>
                    {expiry ? (
                      <p className={`mt-3 flex items-center gap-2 text-xs ${expiry.expired ? "text-error-700" : "text-warning-700"}`}>
                        <Clock3 className="h-4 w-4" aria-hidden />
                        {expiry.label}
                      </p>
                    ) : null}
                    <dl className="mt-4 space-y-2 text-xs text-ink-600">
                      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
                        <dt>Tài khoản nhận quyền</dt>
                        <dd className="break-all text-right font-medium text-ink-800">{request.targetUserId}</dd>
                      </div>
                      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
                        <dt>Người gửi yêu cầu</dt>
                        <dd className="break-all text-right font-medium text-ink-800">{request.requesterId}</dd>
                      </div>
                    </dl>
                    {actorRole === "SUPER_ADMIN" ? (
                      request.canApprove && !expiry?.expired ? (
                        <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => openApproval(request)}>
                          Duyệt yêu cầu
                        </Button>
                      ) : expiry?.expired ? (
                        <p className="mt-4 rounded-xl border border-error-100 bg-error-50 px-3 py-2 text-xs leading-5 text-error-700">
                          Yêu cầu này đã hết hạn và không thể duyệt tiếp.
                        </p>
                      ) : (
                        <p className="mt-4 rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs leading-5 text-ink-600">
                          Bạn không thể duyệt yêu cầu do chính mình gửi hoặc nhận.
                        </p>
                      )
                    ) : (
                      <p className="mt-4 rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs leading-5 text-ink-600">
                        Yêu cầu của bạn đang chờ quản trị cấp cao phê duyệt.
                      </p>
                    )}
                        </>
                      );
                    })()}
                  </article>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {feedback ? (
        <div
          className={`mt-5 rounded-2xl border p-4 text-sm leading-6 ${feedback.tone === "success" ? "border-success-100 bg-success-50 text-success-700" : "border-error-100 bg-error-50 text-error-700"}`}
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <p className="font-semibold">{feedback.message}</p>
          {feedback.detail ? <p className="mt-1 break-words text-current/80">{feedback.detail}</p> : null}
        </div>
      ) : null}

      <Dialog
        open={pendingAction !== null}
        onClose={closeConfirmation}
        title={pendingAction ? actionTitle(pendingAction) : "Xác nhận thao tác"}
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={closeConfirmation} disabled={isSubmitting}>Hủy</Button>
            <Button type="button" onClick={() => void submitAction()} disabled={isSubmitting}>
              {isSubmitting ? "Đang xử lý…" : "Xác nhận"}
            </Button>
          </>
        )}
      >
        {pendingAction === "bootstrap" ? (
          <p className="text-sm leading-6 text-ink-700">
            Bạn đang chuyển tài khoản hiện tại thành {roleLabel("SUPER_ADMIN")}. Hành động này chỉ thành công khi chưa có quản trị cấp cao đang hoạt động và sẽ thu hồi các phiên hiện tại.
          </p>
        ) : pendingAction === "request" ? (
          <p className="text-sm leading-6 text-ink-700">
            Gửi yêu cầu cấp vai trò {roleLabel(desiredRole)} cho tài khoản <span className="break-all font-medium">{targetUserId.trim()}</span>? Yêu cầu sẽ chờ đủ phê duyệt độc lập.
          </p>
        ) : selectedRequest ? (
          <p className="text-sm leading-6 text-ink-700">
            Duyệt yêu cầu <span className="break-all font-medium">{selectedRequest.id}</span> để {desiredRoleLabel(selectedRequest.desiredRole).toLowerCase()} cho tài khoản <span className="break-all font-medium">{selectedRequest.targetUserId}</span>? Chỉ duyệt khi bạn đã kiểm tra đúng người và đúng mục đích thay đổi.
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
