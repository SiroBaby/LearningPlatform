"use client";

import { useEffect, useRef } from "react";

import { PracticeFeedbackPanel } from "@/components/quiz/practice-feedback-panel";
import { Button } from "@/components/ui";
import { formatMediaTime } from "@/lib/media-time-citation";

import type { MediaPlayerKind } from "./media-player";
import type { OpenCheckpointView } from "./use-media-checkpoints";

interface CheckpointQuestionProps {
  readonly open: OpenCheckpointView;
  readonly kind: MediaPlayerKind;
  readonly onSelectAction: (optionId: string) => void;
  readonly onCheckAction: () => void;
  readonly onAdvanceAction: () => void;
  readonly onSkipAction: () => void;
  readonly onSeekAction: (timeSec: number) => void;
}

function getResumeLabel(kind: MediaPlayerKind): string {
  return kind === "VIDEO" ? "Xem tiếp" : "Nghe tiếp";
}

function getReviewLabel(kind: MediaPlayerKind): string {
  return kind === "VIDEO" ? "Xem lại đoạn này" : "Nghe lại đoạn này";
}

/** One question asked while playback is stopped; feedback appears only after "Kiểm tra đáp án". */
export function CheckpointQuestion({
  open,
  kind,
  onSelectAction,
  onCheckAction,
  onAdvanceAction,
  onSkipAction,
  onSeekAction,
}: CheckpointQuestionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { question, feedback, selectedOptionId } = open;
  const status = feedback?.status ?? "idle";
  const isChecked = status === "ready";
  const isLoading = status === "loading";
  const startSec = question.timeRange?.startSec ?? null;

  useEffect(() => {
    headingRef.current?.focus();
  }, [question.id]);

  return (
    <div className="space-y-4">
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink-900 focus:outline-none">
        Câu hỏi tại {formatMediaTime(open.atSec)}
      </h3>
      <fieldset className="space-y-2" disabled={isChecked || isLoading}>
        <legend className="mb-2 text-sm font-medium text-ink-900">
          Câu {question.servedIndex + 1}. {question.stem}
        </legend>
        {question.options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-ink-100 bg-white px-3 py-3 text-sm text-ink-900 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50"
          >
            <input
              type="radio"
              name={`checkpoint-${question.id}`}
              value={option.id}
              checked={selectedOptionId === option.id}
              onChange={() => onSelectAction(option.id)}
              className="mt-0.5 h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span>{option.content}</span>
          </label>
        ))}
      </fieldset>

      {status === "ready" || status === "loading" ? (
        <PracticeFeedbackPanel
          feedback={feedback}
          onJumpAction={startSec === null ? undefined : () => onSeekAction(startSec)}
          jumpLabel={getReviewLabel(kind)}
        />
      ) : null}
      {status === "error" ? (
        <p className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm text-warning-900" role="status">
          Chưa kiểm tra được đáp án.
        </p>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap gap-2 bg-white py-3 lg:static lg:py-0">
        {isChecked ? (
          <Button type="button" onClick={onAdvanceAction}>
            {open.isLastInGroup ? getResumeLabel(kind) : "Câu tiếp theo"}
          </Button>
        ) : (
          <Button type="button" onClick={onCheckAction} disabled={selectedOptionId === null || isLoading}>
            {status === "error" ? "Thử lại" : "Kiểm tra đáp án"}
          </Button>
        )}
        {isChecked ? null : (
          <Button type="button" variant="outline" onClick={onSkipAction}>
            {status === "error" ? getResumeLabel(kind) : "Bỏ qua"}
          </Button>
        )}
      </div>
    </div>
  );
}
