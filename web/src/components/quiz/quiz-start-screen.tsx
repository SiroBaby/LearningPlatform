"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, PlayCircle, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  clearQuizDraft,
  readQuizDraft,
  type QuizDraftState,
} from "@/components/quiz/quiz-session";
import { routes } from "@/lib/routes";
import type { Phase0QuizResponse } from "@/lib/phase0/contracts";
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

export function QuizStartScreen({ quiz }: QuizStartScreenProps) {
  const { notify } = useToast();
  const [mode, setMode] = useState<QuizMode>("practice");
  const [draftByMode, setDraftByMode] = useState<Readonly<Partial<Record<QuizMode, QuizDraftState>>>>({});
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

  function handleResetDraft(): void {
    clearQuizDraft(quiz.id, mode);
    setDraftByMode((currentDraftByMode) => ({
      ...currentDraftByMode,
      [mode]: undefined,
    }));
    notify("Đã xóa phần làm dở. Bạn có thể bắt đầu lại từ đầu.", "success");
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
    </div>
  );
}
