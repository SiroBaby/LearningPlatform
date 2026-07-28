import { CircleAlert, Loader2, RefreshCcw } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LinkButton, StatusPill, TypeBadge } from "@/components/ui";
import type { Phase0Document } from "@/lib/phase0/contracts";
import { getDocumentFailurePresentation, isRetryableDocumentFailureCode } from "@/lib/phase0/document-failure";
import {
  formatBytes,
  formatDateTime,
  getBudgetMessage,
  getBudgetStatusLabel,
  getEstimateStatusLabel,
  getModelSourceLabel,
  getSettledCreditsLabel,
  getStatusLabel,
  mapStatus,
  mapType,
} from "./processing-status-utils";

function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-ink-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 pb-3 last:border-b-0 last:pb-0">
      <dt>{label}</dt>
      <dd className="max-w-[60%] break-words text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

interface ProcessingHeaderProps {
  readonly document: Phase0Document | null;
  readonly detailHref: string;
  readonly libraryHref: string;
  readonly error: string | null;
}

export function ProcessingHeader({ document, detailHref, libraryHref, error }: ProcessingHeaderProps) {
  const mappedStatus = document ? mapStatus(document.status) : "uploaded";
  const mappedType = document ? mapType(document.type) : "pdf";

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {document ? <TypeBadge type={mappedType} /> : null}
              <StatusPill status={mappedStatus} />
              <Badge tone="brand">Tự cập nhật</Badge>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
                {document?.originalName ?? "Đang tải trạng thái tài liệu"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Tài liệu của bạn đang được xử lý. Trang này sẽ tự cập nhật model đã chọn cùng mức ước tính và credit chốt khi có dữ liệu mới.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <LinkButton href={detailHref}>Xem chi tiết tài liệu</LinkButton>
            <LinkButton href={libraryHref} variant="outline">
              Về thư viện
            </LinkButton>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

interface ProcessingStatusPanelProps {
  readonly document: Phase0Document | null;
  readonly isLoading: boolean;
  readonly isRetrySubmitting: boolean;
  readonly retryError: string | null;
  readonly onRetryConfirm: () => void;
}

export function ProcessingStatusPanel({
  document,
  isLoading,
  isRetrySubmitting,
  retryError,
  onRetryConfirm,
}: ProcessingStatusPanelProps) {
  const failurePresentation = document?.status === "FAILED"
    ? getDocumentFailurePresentation(document.errorCode)
    : null;
  const canRetryFailure = document?.status === "FAILED"
    && isRetryableDocumentFailureCode(document.errorCode);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trạng thái xử lý</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang cập nhật trạng thái tài liệu…
          </div>
        ) : null}

        <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-ink-700">
          <p className="font-semibold text-ink-900">Trạng thái hiện tại</p>
          <p className="mt-1">{document ? getStatusLabel(document.status) : "Đang chờ cập nhật"}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SpecItem label="Model đã chọn" value={document?.selectedModelLabel ?? "Chưa có"} />
          <SpecItem label="Nguồn xử lý" value={getModelSourceLabel(document?.selectedModelKind ?? null)} />
          <SpecItem label="Ước tính ban đầu" value={getEstimateStatusLabel(document)} />
          <SpecItem label="Credit chốt" value={getSettledCreditsLabel(document)} />
          <SpecItem label="Mức ngân sách" value={getBudgetStatusLabel(document?.budgetStatus ?? null)} />
          <SpecItem label="Cập nhật gần nhất" value={document ? formatDateTime(document.updatedAt) : "Chưa có"} />
        </div>

        {failurePresentation ? (
          <div className="space-y-3 rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
            <div>
              <p className="font-semibold">{failurePresentation.title}</p>
              <p className="mt-1">{failurePresentation.description}</p>
            </div>
            {canRetryFailure ? (
              <Button type="button" variant="outline" onClick={onRetryConfirm} disabled={isRetrySubmitting} aria-busy={isRetrySubmitting}>
                <RefreshCcw className={isRetrySubmitting ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {isRetrySubmitting ? "Đang thử lại…" : "Thử lại"}
              </Button>
            ) : null}
            {retryError ? (
              <div className="rounded-2xl border border-warning-100 bg-white/80 p-3 text-warning-800" role="status">
                {retryError}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-2xl border border-warning-100 bg-warning-50/60 p-4 text-sm leading-6 text-warning-800">
          {getBudgetMessage(document)}
        </div>
      </CardBody>
    </Card>
  );
}

interface ProcessingDocumentInfoPanelProps {
  readonly document: Phase0Document | null;
  readonly detailHref: string;
}

export function ProcessingDocumentInfoPanel({ document, detailHref }: ProcessingDocumentInfoPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin tài liệu</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3 text-sm text-ink-600">
        <SpecRow label="Tên file" value={document?.originalName ?? "Chưa có"} />
        <SpecRow label="Kích thước" value={document ? formatBytes(document.sizeBytes) : "Chưa có"} />
        <SpecRow label="Tạo lúc" value={document ? formatDateTime(document.createdAt) : "Chưa có"} />
        <SpecRow label="Cập nhật lúc" value={document ? formatDateTime(document.updatedAt) : "Chưa có"} />
        <SpecRow label="Ngôn ngữ" value={document?.language ?? "Chưa có"} />
        <SpecRow label="Số trang" value={document?.pageCount !== null && document?.pageCount !== undefined ? String(document.pageCount) : "Chưa có"} />
        <SpecRow label="Model đã chọn" value={document?.selectedModelLabel ?? "Chưa có"} />
        <SpecRow label="Nguồn xử lý" value={getModelSourceLabel(document?.selectedModelKind ?? null)} />
        <div className="flex flex-wrap gap-2 pt-2">
          <LinkButton href={detailHref} size="sm">
            Xem chi tiết
          </LinkButton>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
            Cập nhật ngay
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
