"use client";

import { Button, Card, CardBody, LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

import { CheckpointQuestion } from "./checkpoint-question";
import type { MediaPlayerKind } from "./media-player";
import type { UseMediaCheckpointsResult } from "./use-media-checkpoints";

interface CheckpointPanelProps {
  readonly kind: MediaPlayerKind;
  readonly quizId: string | null;
  readonly checkpoints: UseMediaCheckpointsResult;
  /** The media cannot be played at all (for example the file is gone). */
  readonly isSourceUnavailable: boolean;
  readonly className?: string;
}

function getIdleMessage(kind: MediaPlayerKind, count: number, isEnabled: boolean): string {
  const noun = kind === "VIDEO" ? "Bài" : "Bài nghe";
  const subject = kind === "VIDEO" ? "Video" : "Âm thanh";
  if (!isEnabled) return `${noun} có ${count} câu hỏi. ${subject} sẽ không dừng để hỏi.`;
  return `${noun} có ${count} câu hỏi. ${subject} sẽ dừng để bạn trả lời.`;
}

function getToggleLabel(kind: MediaPlayerKind): string {
  return kind === "VIDEO" ? "Dừng để hỏi khi xem" : "Dừng để hỏi khi nghe";
}

interface PanelShellProps {
  readonly announcement: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

function PanelShell({ announcement, className, children }: PanelShellProps) {
  return (
    <aside aria-label="Câu hỏi trong bài" className={`min-w-0 ${className ?? ""}`}>
      <Card>
        <CardBody className="space-y-4">
          <p role="status" className="sr-only">{announcement}</p>
          {children}
        </CardBody>
      </Card>
    </aside>
  );
}

export function CheckpointPanel({ kind, quizId, checkpoints, isSourceUnavailable, className }: CheckpointPanelProps) {
  if (quizId === null || checkpoints.loadState === "idle" || checkpoints.loadState === "empty") return null;
  const quizLink = <LinkButton href={routes.quizStart(quizId)} variant="outline">Làm quiz của bài này</LinkButton>;

  if (isSourceUnavailable) {
    return (
      <PanelShell className={className} announcement="">
        <p className="text-sm text-ink-700">Bạn vẫn có thể làm quiz của bài này.</p>
        {quizLink}
      </PanelShell>
    );
  }
  if (checkpoints.loadState === "loading") {
    return <PanelShell className={className} announcement=""><p className="animate-pulse text-sm text-ink-600 motion-reduce:animate-none">Đang tải câu hỏi…</p></PanelShell>;
  }
  if (checkpoints.loadState === "error") {
    return (
      <PanelShell className={className} announcement="">
        <p className="text-sm text-ink-700" role="alert">Chưa tải được câu hỏi.</p>
        <Button type="button" variant="outline" onClick={checkpoints.retryLoad}>Thử lại</Button>
      </PanelShell>
    );
  }
  if (checkpoints.openCheckpoint) {
    return (
      <PanelShell className={className} announcement="Đã dừng để hỏi bạn.">
        <CheckpointQuestion
          open={checkpoints.openCheckpoint}
          kind={kind}
          onSelectAction={checkpoints.selectOption}
          onCheckAction={checkpoints.checkAnswer}
          onAdvanceAction={checkpoints.advance}
          onSkipAction={checkpoints.skip}
          onSeekAction={checkpoints.seekToSeconds}
        />
      </PanelShell>
    );
  }
  const isAllAnswered = checkpoints.items.length > 0 && checkpoints.items.every((item) => item.status === "answered");
  if (isAllAnswered) {
    return (
      <PanelShell className={className} announcement="">
        <p className="text-sm text-ink-700">Bạn đã trả lời hết câu hỏi trong bài.</p>
        {quizLink}
      </PanelShell>
    );
  }
  return (
    <PanelShell className={className} announcement="">
      <p className="text-sm text-ink-700">
        {getIdleMessage(kind, checkpoints.timedQuestionCount, checkpoints.isPauseEnabled)}
      </p>
      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium text-ink-900">
        <input
          type="checkbox"
          checked={checkpoints.isPauseEnabled}
          onChange={(event) => checkpoints.setPauseEnabled(event.target.checked)}
          className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        />
        {getToggleLabel(kind)}
      </label>
    </PanelShell>
  );
}
