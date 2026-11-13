"use client";

import { Button } from "@/components/ui";
import { formatMediaTime } from "@/lib/media-time-citation";
import type { CheckpointStatus } from "@/lib/media-checkpoints/checkpoint-engine";

import type { MediaPlayerKind } from "./media-player";
import type { CheckpointListItem } from "./use-media-checkpoints";

interface CheckpointListProps {
  readonly items: readonly CheckpointListItem[];
  readonly kind: MediaPlayerKind;
  readonly onSeekAction: (timeSec: number) => void;
}

const STATUS_LABELS: Readonly<Record<CheckpointStatus, string>> = {
  upcoming: "Sắp tới",
  open: "Đang hỏi",
  answered: "Đã trả lời",
  passed: "Đã qua",
};

export function CheckpointList({ items, kind, onSeekAction }: CheckpointListProps) {
  if (items.length === 0) return null;
  const heading = kind === "VIDEO" ? "Câu hỏi trong video" : "Câu hỏi trong bài nghe";

  return (
    <section aria-labelledby="checkpoint-list-heading" className="space-y-2">
      <h3 id="checkpoint-list-heading" className="text-sm font-semibold text-ink-900">{heading}</h3>
      <ol className="divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
        {items.map(({ group, status }) => (
          <li key={group.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-3">
              <span className="font-medium tabular-nums text-ink-900">{formatMediaTime(group.atSec)}</span>
              <span className="text-ink-600">{STATUS_LABELS[status]}</span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onSeekAction(group.startSec)}>
              Tới đoạn này
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
