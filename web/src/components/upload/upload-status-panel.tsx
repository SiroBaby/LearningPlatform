import { CircleAlert, RefreshCcw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { Phase0EstimateResponse, Phase0ModelSelectionKind } from "@/lib/phase0/contracts";
import { formatCredits, formatDateTime, getModelSourceLabel, getUploadStepLabel, type UploadStep } from "./upload-workspace-utils";
import { UploadSpecRow } from "./upload-workspace-primitives";

interface UploadStatusPanelProps {
  readonly step: UploadStep;
  readonly statusTone: "brand" | "success" | "warning";
  readonly createdAt: string | null;
  readonly confirmStatus: string | null;
  readonly selectedModelLabel: string | null;
  readonly selectedModelKind: Phase0ModelSelectionKind | null;
  readonly estimate: Phase0EstimateResponse | null;
  readonly isEstimating: boolean;
  readonly storageError: string | null;
  readonly confirmError: string | null;
  readonly canRetryConfirm: boolean;
  readonly onRetryConfirm: () => void;
}

export function UploadStatusPanel({
  step,
  statusTone,
  createdAt,
  confirmStatus,
  selectedModelLabel,
  selectedModelKind,
  estimate,
  isEstimating,
  storageError,
  confirmError,
  canRetryConfirm,
  onRetryConfirm,
}: UploadStatusPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-700">Trạng thái hiện tại</p>
          <CardTitle>Theo dõi quá trình tải lên</CardTitle>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="rounded-3xl border border-ink-100 bg-ink-50/70 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-brand-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink-900">Tiến trình tải lên</p>
                <Badge tone={statusTone}>{step === "idle" ? "Đang chờ tệp" : getUploadStepLabel(step)}</Badge>
              </div>
              <p className="text-sm leading-6 text-ink-700">
                Tại đây bạn sẽ thấy tài liệu đang ở bước nào và có cần thử lại hay không.
              </p>
            </div>
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <UploadSpecRow label="Bắt đầu lúc" value={createdAt ? formatDateTime(createdAt) : "Chưa bắt đầu"} />
          <UploadSpecRow label="Đã tải tệp lên" value={step === "uploaded" || step === "confirming" || step === "confirmed" ? "Đã xong" : "Chưa"} />
          <UploadSpecRow label="Bước xử lý" value={confirmStatus ?? (confirmError ? "Chưa thể tiếp tục" : "Chưa có")} />
          <UploadSpecRow label="Cách xử lý đã chọn" value={selectedModelLabel ?? "Chưa chọn"} />
          <UploadSpecRow label="Nguồn xử lý" value={selectedModelKind ? getModelSourceLabel(selectedModelKind) : "Chưa chọn"} />
          <UploadSpecRow
            label="Ước tính ban đầu"
            value={estimate ? (estimate.selectedModelKind === "PLAN" ? `${formatCredits(estimate.estimatedCredits)} lượt dùng` : "Không dùng lượt dùng trong gói") : isEstimating ? "Đang tính" : "Chưa có"}
          />
        </dl>

        {storageError ? (
          <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{storageError}</span>
            </div>
          </div>
        ) : null}

        {confirmError ? (
          <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4 text-sm text-warning-800">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Tệp đã tải lên nhưng chưa chuyển sang xử lý</p>
                <p className="mt-1">{confirmError}</p>
              </div>
            </div>
          </div>
        ) : null}

        {canRetryConfirm ? (
          <Button type="button" variant="outline" onClick={onRetryConfirm}>
            <RefreshCcw className="h-4 w-4" />
            Thử lại
          </Button>
        ) : null}

        <div className="rounded-2xl border border-ink-100 bg-white p-4 text-sm leading-6 text-ink-700">
          Hỗ trợ tệp <span className="font-semibold text-ink-900">PDF</span> và <span className="font-semibold text-ink-900">TXT</span>. Nếu có lỗi, bạn chỉ cần chọn lại tệp hoặc thử tải lên lần nữa.
        </div>
      </CardBody>
    </Card>
  );
}
