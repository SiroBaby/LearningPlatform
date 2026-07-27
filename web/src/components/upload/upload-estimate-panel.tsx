import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import type { Phase0EstimateResponse, Phase0ModelSelectionKind } from "@/lib/phase0/contracts";
import { ESTIMATE_HELPER_TEXT, getModelSourceLabel } from "./upload-workspace-utils";
import { UploadSpecItem } from "./upload-workspace-primitives";
import { toUploadEstimateSummaryPresentation } from "./use-upload-model-estimate";

interface UploadEstimatePanelProps {
  readonly selectedModelLabel: string | null;
  readonly selectedModelKind: Phase0ModelSelectionKind | null;
  readonly isEstimating: boolean;
  readonly estimateError: string | null;
  readonly estimate: Phase0EstimateResponse | null;
}

export function UploadEstimatePanel({
  selectedModelLabel,
  selectedModelKind,
  isEstimating,
  estimateError,
  estimate,
}: UploadEstimatePanelProps) {
  const summary = estimate ? toUploadEstimateSummaryPresentation(estimate) : null;

  return (
    <div className="space-y-4 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ink-900">Ước tính trước khi tải lên</h3>
        <p className="text-sm leading-6 text-ink-600">{ESTIMATE_HELPER_TEXT}</p>
      </div>

      {selectedModelLabel && selectedModelKind ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <UploadSpecItem label="Model đã chọn" value={selectedModelLabel} />
          <UploadSpecItem label="Nguồn dùng để xử lý" value={getModelSourceLabel(selectedModelKind)} />
        </div>
      ) : (
        <div className="rounded-2xl border border-ink-100 bg-white p-4 text-sm text-ink-700">
          Chọn model để xem ước tính cho tài liệu này.
        </div>
      )}

      {isEstimating ? (
        <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 text-sm text-ink-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tính ước tính cho file và model bạn đã chọn…
        </div>
      ) : null}

      {estimateError ? (
        <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">{estimateError}</div>
      ) : null}

      {summary ? (
        <div className="space-y-3 rounded-2xl border border-brand-100 bg-white p-4 text-sm text-ink-700">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={summary.badgeTone}>{summary.badgeLabel}</Badge>
            <Badge tone="neutral">{summary.modelLabel}</Badge>
          </div>
          <p className="font-semibold text-ink-900">{summary.summary}</p>
          <p>{summary.detail}</p>
        </div>
      ) : null}
    </div>
  );
}
