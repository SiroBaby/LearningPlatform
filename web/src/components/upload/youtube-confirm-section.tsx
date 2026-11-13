import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui";
import type { Phase0SubtitlePreviewResponse } from "@/lib/phase0/contracts";

import { SubtitlePreviewTable } from "./subtitle-preview-table";

export const RIGHTS_CHECKBOX_LABEL = "Tôi có quyền dùng video và phụ đề này, và phụ đề khớp với video.";

interface YoutubeConfirmSectionProps {
  readonly rightsInputId: string;
  readonly preview: Phase0SubtitlePreviewResponse;
  readonly isRightsConfirmed: boolean;
  readonly canConfirm: boolean;
  readonly isConfirming: boolean;
  readonly onRightsChange: (isConfirmed: boolean) => void;
  readonly onConfirm: () => void;
}

/** Last step before processing: check the subtitle text, tick the rights box, then confirm. */
export function YoutubeConfirmSection({
  rightsInputId,
  preview,
  isRightsConfirmed,
  canConfirm,
  isConfirming,
  onRightsChange,
  onConfirm,
}: YoutubeConfirmSectionProps) {
  return (
    <section aria-label="Xem lại phụ đề" className="space-y-4 rounded-3xl border border-brand-100 bg-white p-4">
      <h3 className="text-base font-semibold text-ink-900">Xem lại phụ đề</h3>
      <SubtitlePreviewTable preview={preview} />
      <label htmlFor={rightsInputId} className="flex cursor-pointer items-start gap-3 text-sm font-medium text-ink-900">
        <input
          id={rightsInputId}
          type="checkbox"
          checked={isRightsConfirmed}
          onChange={(event) => onRightsChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        />
        {RIGHTS_CHECKBOX_LABEL}
      </label>
      <Button type="button" disabled={!canConfirm} onClick={onConfirm}>
        {isConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isConfirming ? "Đang chuyển sang xử lý" : "Xác nhận và xử lý"}
      </Button>
    </section>
  );
}
