"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { formatMediaTime } from "@/lib/media-time-citation";
import { getSubtitlePreviewPage } from "@/lib/media-playback/subtitle-preview-paging";
import type { Phase0SubtitlePreviewResponse } from "@/lib/phase0/contracts";

interface SubtitlePreviewTableProps {
  readonly preview: Phase0SubtitlePreviewResponse;
}

/** The subtitle text the questions will be made from, 100 rows per page. Cue text is shown as plain text only. */
export function SubtitlePreviewTable({ preview }: SubtitlePreviewTableProps) {
  const [requestedPageIndex, setRequestedPageIndex] = useState(0);
  const page = getSubtitlePreviewPage(preview.cues, requestedPageIndex);
  const hasPreviousPage = page.pageIndex > 0;
  const hasNextPage = page.pageIndex < page.pageCount - 1;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-ink-900">
        {preview.cueCount} đoạn · dài {formatMediaTime(preview.durationSec)}
      </p>
      <div className="max-h-96 overflow-auto rounded-2xl border border-ink-100 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Nội dung phụ đề</caption>
          <thead className="sticky top-0 bg-ink-50 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
            <tr>
              <th scope="col" className="w-36 px-3 py-2">Thời gian</th>
              <th scope="col" className="px-3 py-2">Nội dung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {page.rows.map((cue, rowIndex) => (
              <tr key={page.firstRowNumber + rowIndex} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 text-ink-600">
                  {formatMediaTime(cue.startSec)}–{formatMediaTime(cue.endSec)}
                </td>
                <td className="break-words px-3 py-2 text-ink-900">{cue.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-ink-600">
          <Button type="button" variant="outline" disabled={!hasPreviousPage} onClick={() => setRequestedPageIndex(page.pageIndex - 1)}>
            Trang trước
          </Button>
          <span aria-live="polite">Trang {page.pageIndex + 1}/{page.pageCount}</span>
          <Button type="button" variant="outline" disabled={!hasNextPage} onClick={() => setRequestedPageIndex(page.pageIndex + 1)}>
            Trang sau
          </Button>
        </div>
      ) : null}
    </div>
  );
}
