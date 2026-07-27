"use client";

import { useEffect, useMemo, useState } from "react";
import { Flag, Hourglass, ListChecks, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { routes } from "@/lib/routes";
import { formatSec } from "@/lib/mock-data";
import type { Exam, Question } from "@/lib/types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Dialog, ProgressBar } from "@/components/ui";

interface PracticeExamScreenProps {
  readonly exam: Exam;
  readonly questions: readonly Question[];
  readonly coveredDocumentTitles: readonly string[];
  readonly missingCoverageTitles: readonly string[];
  readonly resultAttemptId: string;
}

interface DraftAnswer {
  readonly questionId: string;
  readonly selectedOptionId: string | null;
  readonly flagged: boolean;
}

const EXAM_DURATION_SECONDS = 25 * 60;

function buildDraftAnswers(questions: readonly Question[]): DraftAnswer[] {
  return questions.map((question) => ({
    questionId: question.id,
    selectedOptionId: null,
    flagged: false,
  }));
}

function getQuestionIndexById(questions: readonly Question[], questionId: string): number {
  return questions.findIndex((question) => question.id === questionId);
}

function countAnsweredQuestions(answers: readonly DraftAnswer[]): number {
  return answers.filter((answer) => answer.selectedOptionId !== null).length;
}

function countFlaggedQuestions(answers: readonly DraftAnswer[]): number {
  return answers.filter((answer) => answer.flagged).length;
}

export function PracticeExamScreen({
  exam,
  questions,
  coveredDocumentTitles,
  missingCoverageTitles,
  resultAttemptId,
}: PracticeExamScreenProps) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<DraftAnswer[]>(() => buildDraftAnswers(questions));
  const [secondsLeft, setSecondsLeft] = useState(EXAM_DURATION_SECONDS);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((currentSeconds) => {
        if (currentSeconds <= 1) {
          window.clearInterval(timer);
          return 0;
        }

        return currentSeconds - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const answeredCount = countAnsweredQuestions(answers);
  const flaggedCount = countFlaggedQuestions(answers);
  const progressPct = Math.round((answeredCount / questions.length) * 100);
  const unansweredCount = questions.length - answeredCount;
  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentIndex];
  const currentQuestionNumber = currentIndex + 1;

  const coverageSummary = useMemo(() => {
    if (missingCoverageTitles.length === 0) {
      return "Tất cả tài liệu đã chọn đều đã có câu hỏi trong practice set này.";
    }

    return `Bộ đề hiện lấy câu hỏi từ ${coveredDocumentTitles.length} tài liệu. ${missingCoverageTitles.length} tài liệu còn lại mới có checkpoint hoặc output chưa sẵn sàng, nên chưa đi vào đề thi thử.`;
  }, [coveredDocumentTitles.length, missingCoverageTitles]);

  function selectOption(optionId: string): void {
    setAnswers((currentAnswers) =>
      currentAnswers.map((answer, index) =>
        index === currentIndex
          ? {
              ...answer,
              selectedOptionId: optionId,
            }
          : answer,
      ),
    );
  }

  function toggleFlag(questionIndex: number): void {
    setAnswers((currentAnswers) =>
      currentAnswers.map((answer, index) =>
        index === questionIndex
          ? {
              ...answer,
              flagged: !answer.flagged,
            }
          : answer,
      ),
    );
  }

  function submitExam(): void {
    router.push(routes.examResult(exam.id, resultAttemptId));
  }

  function goToQuestion(questionIndex: number): void {
    setCurrentIndex(questionIndex);
  }

  const questionStatusTone = currentAnswer.selectedOptionId ? "success" : currentAnswer.flagged ? "warning" : "neutral";

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">Practice exam</Badge>
                  <Badge tone="neutral">Timed mode</Badge>
                </div>
                <CardTitle className="mt-3 text-xl">{exam.name}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Bộ đề trộn câu hỏi từ các tài liệu đã chọn. Đáp án đúng chỉ xuất hiện ở màn hình kết quả sau khi nộp bài.
                </p>
              </div>
              <div className="rounded-2xl border border-ink-100 px-4 py-3 text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">Time left</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-ink-900">{formatSec(secondsLeft)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <ListChecks className="h-4 w-4 text-brand-600" />
                  Progress
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{answeredCount}/{questions.length}</p>
                <p className="mt-1 text-sm text-ink-500">questions answered</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Flag className="h-4 w-4 text-warning-700" />
                  Flagged
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{flaggedCount}</p>
                <p className="mt-1 text-sm text-ink-500">for later review</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Hourglass className="h-4 w-4 text-review-600" />
                  Coverage
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{coveredDocumentTitles.length}</p>
                <p className="mt-1 text-sm text-ink-500">documents in current question pool</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-ink-600">
                <span>Completion</span>
                <span className="font-medium text-ink-900">{progressPct}%</span>
              </div>
              <ProgressBar value={progressPct} tone="brand" />
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coverage map</CardTitle>
            <p className="mt-1 text-sm text-ink-600">Giải thích rõ đề thi này đang lấy câu hỏi từ đâu.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="space-y-2">
              {coveredDocumentTitles.map((title) => (
                <div key={title} className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-800">
                  {title}
                </div>
              ))}
            </div>
            {missingCoverageTitles.length > 0 ? (
              <div className="space-y-2">
                {missingCoverageTitles.map((title) => (
                  <div key={title} className="rounded-2xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                    {title}
                  </div>
                ))}
              </div>
            ) : null}
            <p className="text-sm leading-6 text-ink-600">{coverageSummary}</p>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <Card>
          <CardHeader>
            <CardTitle>Question palette</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Chọn nhanh câu hỏi, xem câu nào đã trả lời, chưa trả lời hoặc được gắn cờ.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 xl:grid-cols-4">
              {questions.map((question) => {
                const questionIndex = getQuestionIndexById(questions, question.id);
                const answer = answers[questionIndex];
                const isActive = questionIndex === currentIndex;
                const paletteClass = answer.selectedOptionId
                  ? "border-success-200 bg-success-50 text-success-800"
                  : answer.flagged
                    ? "border-warning-200 bg-warning-50 text-warning-800"
                    : "border-ink-200 bg-white text-ink-700";

                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => goToQuestion(questionIndex)}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${paletteClass} ${isActive ? "ring-2 ring-brand-500/30" : "hover:border-brand-200"}`}
                    aria-current={isActive ? "step" : undefined}
                  >
                    {question.ordinal}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-800">
                Answered: {answeredCount}
              </div>
              <div className="rounded-2xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                Flagged: {flaggedCount}
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-700">
                Unanswered: {unansweredCount}
              </div>
            </div>
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
              Mỗi thay đổi trong mock UI được giữ tại chỗ như một draft cục bộ. Điều này mô phỏng autosave mà không cần backend thật.
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">Question {currentQuestionNumber}/{questions.length}</Badge>
                  <Badge tone={questionStatusTone}>{currentAnswer.flagged ? "Flagged" : currentAnswer.selectedOptionId ? "Answered" : "Open"}</Badge>
                  <Badge tone="neutral">{currentQuestion.topic}</Badge>
                </div>
                <CardTitle className="mt-3 text-xl">{currentQuestion.stem}</CardTitle>
              </div>
              <Button
                variant={currentAnswer.flagged ? "secondary" : "outline"}
                onClick={() => toggleFlag(currentIndex)}
              >
                <Flag className="h-4 w-4" />
                {currentAnswer.flagged ? "Flagged" : "Flag for review"}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="sr-only">Choose one answer</legend>
              {currentQuestion.options.map((option) => {
                const inputId = `${currentQuestion.id}-${option.id}`;
                const isChecked = currentAnswer.selectedOptionId === option.id;

                return (
                  <label
                    key={option.id}
                    htmlFor={inputId}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                      isChecked
                        ? "border-brand-200 bg-brand-50"
                        : "border-ink-100 hover:border-brand-200 hover:bg-brand-50/40"
                    }`}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name={currentQuestion.id}
                      value={option.id}
                      checked={isChecked}
                      onChange={() => selectOption(option.id)}
                      className="mt-1 h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-ink-900">{option.text}</p>
                    </div>
                  </label>
                );
              })}
            </fieldset>

            <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
              Hint policy: practice screen chỉ cho biết topic và trạng thái câu hỏi. Không có citation hay explanation nào xuất hiện trước khi submit để tránh lộ đáp án.
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
              <Button
                variant="outline"
                onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                disabled={currentIndex === 0}
              >
                Previous
              </Button>
              <div className="flex flex-wrap gap-2">
                {currentIndex < questions.length - 1 ? (
                  <Button onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}>
                    Next question
                  </Button>
                ) : (
                  <Button onClick={() => setIsSubmitDialogOpen(true)}>
                    <Sparkles className="h-4 w-4" />
                    Submit practice exam
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </section>

      <Dialog
        open={isSubmitDialogOpen}
        onClose={() => setIsSubmitDialogOpen(false)}
        title="Submit practice exam?"
        footer={(
          <>
            <Button variant="outline" onClick={() => setIsSubmitDialogOpen(false)}>
              Keep reviewing
            </Button>
            <Button onClick={submitExam}>Submit now</Button>
          </>
        )}
      >
        <div className="space-y-3 text-sm leading-6 text-ink-600">
          <p>
            Bạn đã trả lời {answeredCount}/{questions.length} câu. {unansweredCount > 0 ? `Còn ${unansweredCount} câu chưa chọn đáp án.` : "Tất cả câu hỏi đã có đáp án."}
          </p>
          <p>
            Sau khi nộp bài, màn hình kết quả sẽ hiện topic breakdown, explanation và citation cho từng câu sai.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
