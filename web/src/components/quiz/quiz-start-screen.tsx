"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, History, Loader2, PlayCircle, RefreshCcw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatVietnameseDateTime } from "@/lib/date-time";
import {
  clearQuizDraft,
  readQuizDraft,
  type QuizDraftState,
} from "@/components/quiz/quiz-session";
import { routes } from "@/lib/routes";
import { getPhase0AttemptHistory } from "@/lib/phase0/client";
import type { Phase0AttemptHistoryItem, Phase0QuizResponse } from "@/lib/phase0/contracts";
import { getPhase0UiErrorMessage } from "@/lib/phase0/ui-errors";
import type { QuizMode } from "@/lib/types";

interface QuizStartScreenProps {
  readonly quiz: Phase0QuizResponse;
}

const MODE_OPTIONS: ReadonlyArray<{
  readonly value: QuizMode;
  readonly title: string;
  readonly description: string;
}> = [
  {
    value: "practice",
    title: "Chế độ luyện tập",
    description: "Chọn đáp án rồi bấm Kiểm tra đáp án để xem phản hồi cho từng câu.",
  },
  {
    value: "test",
    title: "Chế độ kiểm tra",
    description: "Làm trọn bài trước, chỉ xem kết quả sau khi nộp.",
  },
];

function getResumeHref(quizId: string, mode: QuizMode): string {
  return `${routes.quizPlay(quizId)}?mode=${mode}&resume=1`;
}

function toScorePercent(score: number, questionCount: number): number {
  return questionCount === 0 ? 0 : Math.round((score / questionCount) * 100);
}

interface AttemptHistoryCardProps {
  readonly quizId: string;
  readonly attempts: readonly Phase0AttemptHistoryItem[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

function AttemptHistoryCard({ quizId, attempts, isLoading, error, onRetry }: AttemptHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-brand-600" aria-hidden />
          <CardTitle>Lịch sử làm bài</CardTitle>
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-ink-600" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tải lịch sử làm bài…
          </div>
        ) : null}

        {!isLoading && error ? (
          <div className="flex flex-col gap-3 text-sm text-error-700 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <p>{error}</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-4 w-4" aria-hidden />
              Thử lại
            </Button>
          </div>
        ) : null}

        {!isLoading && !error && attempts.length === 0 ? (
          <p className="text-sm leading-6 text-ink-600">
            Bạn chưa có lần làm bài nào. Kết quả sẽ xuất hiện tại đây sau khi bạn nộp bài.
          </p>
        ) : null}

        {!isLoading && !error && attempts.length > 0 ? (
          <ol className="space-y-3">
            {attempts.map((attempt, index) => {
              const scorePercent = toScorePercent(attempt.score, attempt.questionCount);
              return (
                <li key={attempt.attemptId} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-ink-900">Lần {attempts.length - index}</p>
                      <p className="text-sm text-ink-600">{formatVietnameseDateTime(attempt.submittedAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                        {scorePercent}%
                      </span>
                      <span className="text-sm text-ink-600">
                        {attempt.score}/{attempt.questionCount} câu đúng
                      </span>
                      <LinkButton href={routes.quizResult(quizId, attempt.attemptId)} size="sm" variant="outline">
                        Xem kết quả
                      </LinkButton>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function QuizStartScreen({ quiz }: QuizStartScreenProps) {
  const { notify } = useToast();
  const [mode, setMode] = useState<QuizMode>("practice");
  const [draftByMode, setDraftByMode] = useState<Readonly<Partial<Record<QuizMode, QuizDraftState>>>>({});
  const [attemptHistory, setAttemptHistory] = useState<readonly Phase0AttemptHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const draft = draftByMode[mode] ?? null;
  const answeredCount = useMemo(
    () => Object.values(draft?.answers ?? {}).filter((value) => typeof value === "string").length,
    [draft],
  );
  const startHref = `${routes.quizPlay(quiz.id)}?mode=${mode}`;
  const resumeHref = draft ? getResumeHref(quiz.id, mode) : null;

  useEffect(() => {
    queueMicrotask(() => {
      setDraftByMode({
        practice: readQuizDraft(quiz.id, "practice") ?? undefined,
        test: readQuizDraft(quiz.id, "test") ?? undefined,
      });
    });
  }, [quiz.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadAttemptHistory(): Promise<void> {
      setIsHistoryLoading(true);
      setHistoryError(null);

      try {
        const response = await getPhase0AttemptHistory(quiz.id);
        if (!cancelled) {
          setAttemptHistory(response);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setHistoryError(getPhase0UiErrorMessage(error, "Chưa thể tải lịch sử làm bài lúc này."));
        }
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    }

    queueMicrotask(() => {
      if (!cancelled) {
        void loadAttemptHistory();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [historyReloadKey, quiz.id]);

  function handleResetDraft(): void {
    clearQuizDraft(quiz.id, mode);
    setDraftByMode((currentDraftByMode) => ({
      ...currentDraftByMode,
      [mode]: undefined,
    }));
    notify("Đã xóa phần làm dở. Bạn có thể bắt đầu lại từ đầu.", "success");
  }

  if (quiz.questions.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardBody className="space-y-4">
            <h2 className="text-xl font-semibold text-ink-900">Quiz chưa có câu hỏi</h2>
            <p className="text-sm leading-6 text-ink-600">
              Bộ câu hỏi chưa sẵn sàng để làm. Bạn hãy quay lại thư viện sau ít phút.
            </p>
            <LinkButton href={routes.library} variant="outline">Về thư viện</LinkButton>
          </CardBody>
        </Card>
        <AttemptHistoryCard
          quizId={quiz.id}
          attempts={attemptHistory}
          isLoading={isHistoryLoading}
          error={historyError}
          onRetry={() => setHistoryReloadKey((currentKey) => currentKey + 1)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">Quiz</Badge>
              <Badge>{quiz.questions.length} câu</Badge>
            </div>

            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Sẵn sàng làm bài?</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-600">
                Chọn cách làm bài, xem số câu hỏi và tiếp tục nếu bạn đang làm dở.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardBody className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink-700">
                    <Clock3 className="h-4 w-4 text-brand-600" aria-hidden />
                    Số câu hỏi
                  </div>
                  <p className="text-2xl font-semibold text-ink-900">{quiz.questions.length}</p>
                </CardBody>
              </Card>

              <Card>
                <CardBody className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink-700">
                    <RotateCcw className="h-4 w-4 text-brand-600" aria-hidden />
                    Tiến độ làm dở
                  </div>
                  <p className="text-2xl font-semibold text-ink-900">{draft ? `${answeredCount}/${quiz.questions.length}` : "—"}</p>
                </CardBody>
              </Card>
            </div>

            <div className="rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm leading-6 text-ink-600">
              Bạn có thể bắt đầu ngay hoặc tiếp tục phần đã làm dở trước đó.
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Chọn chế độ làm bài</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {MODE_OPTIONS.map((option) => {
                  const isActive = option.value === mode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setMode(option.value)}
                      className={`block w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                        isActive
                          ? "border-brand-200 bg-brand-50"
                          : "border-ink-100 bg-white hover:border-brand-100 hover:bg-brand-50/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink-900">{option.title}</p>
                          <p className="mt-1 text-sm text-ink-600">{option.description}</p>
                        </div>
                        {isActive ? <Badge tone="brand">Đã chọn</Badge> : null}
                      </div>
                    </button>
                  );
                })}

                <div className="rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-600">
                  {mode === "practice"
                    ? "Ở chế độ luyện tập, bạn chọn đáp án rồi bấm Kiểm tra đáp án khi muốn xem phản hồi."
                    : "Ở chế độ kiểm tra, bạn làm trọn bài trước rồi xem kết quả sau khi nộp."}
                </div>
              </CardBody>
            </Card>

            {draft ? (
              <Card className="border-warning-100 bg-warning-50/60">
                <CardBody className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="font-semibold text-warning-800">Bạn có phần làm dở</p>
                        <p className="mt-1 text-sm text-warning-800/90">
                          Bạn đã làm {answeredCount}/{quiz.questions.length} câu ở chế độ này.
                        </p>
                      </div>
                      <Badge tone="warning">Đã lưu tạm</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton href={resumeHref ?? startHref}>
                        <PlayCircle className="h-4 w-4" aria-hidden />
                        Tiếp tục làm bài
                      </LinkButton>
                      <Button variant="outline" onClick={handleResetDraft}>
                        Làm lại từ đầu
                      </Button>

                  </div>
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardBody className="space-y-3">
                <LinkButton href={startHref} className="w-full justify-center">
                  <PlayCircle className="h-4 w-4" aria-hidden />
                  Bắt đầu quiz
                </LinkButton>
                <p className="text-xs leading-5 text-ink-500">
                  Phần làm dở của bạn sẽ được giữ lại trên thiết bị này cho đến khi bạn nộp bài thành công.
                </p>
              </CardBody>
            </Card>
          </div>
        </CardBody>
      </Card>
      <AttemptHistoryCard
        quizId={quiz.id}
        attempts={attemptHistory}
        isLoading={isHistoryLoading}
        error={historyError}
        onRetry={() => setHistoryReloadKey((currentKey) => currentKey + 1)}
      />
    </div>
  );
}
