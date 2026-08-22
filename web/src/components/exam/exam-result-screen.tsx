import Link from "next/link";
import { ArrowRight, Bot, BookOpen, CircleCheck, CircleX, RotateCcw, Target } from "lucide-react";
import { routes } from "@/lib/routes";
import { formatDateTime, formatSec } from "@/lib/mock-data";
import type { Attempt, Exam, Question, QuizOption } from "@/lib/types";
import { BarChart, Badge, Card, CardBody, CardHeader, CardTitle, CitationSnippet, LinkButton, ProgressBar, ProgressRing } from "@/components/ui";

interface ExamResultScreenProps {
  readonly exam: Exam;
  readonly attempt: Attempt;
  readonly questions: readonly Question[];
}

interface QuestionReviewItem {
  readonly question: Question;
  readonly selectedOption: QuizOption | null;
  readonly correctOption: QuizOption;
  readonly correct: boolean;
}

function buildQuestionReviewItems(
  questions: readonly Question[],
  attempt: Attempt,
): readonly QuestionReviewItem[] {
  return attempt.answers.flatMap((answer) => {
    const question = questions.find((questionItem) => questionItem.id === answer.questionId);

    if (!question) {
      return [];
    }

    const selectedOption = question.options.find((option) => option.id === answer.selectedOptionId) ?? null;
    const correctOption = question.options.find((option) => option.id === question.correctOptionId);

    if (!correctOption) {
      return [];
    }

    return [
      {
        question,
        selectedOption,
        correctOption,
        correct: answer.correct,
      },
    ];
  });
}

function getMasteryEstimate(scorePct: number, readinessPct: number): number {
  return Math.round((scorePct + readinessPct) / 2);
}

function buildTopicChart(attempt: Attempt): Array<{
  label: string;
  value: number;
  tone: "success" | "error" | "warning";
}> {
  return attempt.topicBreakdown.map((topic) => ({
    label: topic.topic,
    value: Math.round((topic.correct / topic.total) * 100),
    tone: topic.correct === topic.total ? "success" : topic.correct === 0 ? "error" : "warning",
  }));
}

function getWrongAnswersCount(attempt: Attempt): number {
  return attempt.totalCount - attempt.correctCount;
}

function getRetryPriorityText(attempt: Attempt): string {
  const lowestTopic = attempt.topicBreakdown.reduce((lowest, current) => {
    const lowestPct = lowest.correct / lowest.total;
    const currentPct = current.correct / current.total;
    return currentPct < lowestPct ? current : lowest;
  }, attempt.topicBreakdown[0]);

  return `${lowestTopic.topic} là vùng cần retry đầu tiên vì hiện chỉ đúng ${lowestTopic.correct}/${lowestTopic.total} câu.`;
}

export function ExamResultScreen({ exam, attempt, questions }: ExamResultScreenProps) {
  const questionReviewItems = buildQuestionReviewItems(questions, attempt);
  const topicChart = buildTopicChart(attempt);
  const masteryEstimate = getMasteryEstimate(attempt.scorePct, exam.readinessPct);
  const wrongAnswersCount = getWrongAnswersCount(attempt);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">Practice exam result</Badge>
                <Badge tone={attempt.scorePct >= exam.targetScorePct ? "success" : "warning"}>
                  {attempt.mode}
                </Badge>
              </div>
              <div>
                <CardTitle className="text-xl">{exam.name}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Bài nộp lúc {formatDateTime(attempt.submittedAt)}. Kết quả này giữ citation cho từng câu để bạn sửa lỗi dựa trên nguồn, không phải học lại mù.
                </p>
              </div>
            </div>
            <ProgressRing value={attempt.scorePct} tone={attempt.scorePct >= exam.targetScorePct ? "success" : "warning"} label="Exam score" />
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Score</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{attempt.scorePct}%</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Correct</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{attempt.correctCount}/{attempt.totalCount}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Time spent</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{formatSec(attempt.timeSpentSec)}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Mastery estimate</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{masteryEstimate}%</p>
              </div>
            </div>

            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-800">
              {attempt.scorePct >= exam.targetScorePct
                ? "Bạn đã vượt target score. Bước tiếp theo nên là giữ nhịp review ngắn để không rơi phong độ trước ngày thi."
                : `Bạn còn thiếu ${exam.targetScorePct - attempt.scorePct} điểm phần trăm để đạt mục tiêu. Tập trung sửa ${wrongAnswersCount} câu sai theo citation sẽ hiệu quả hơn làm thêm đề mới ngay.`}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next actions</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Hướng dẫn rõ learner nên làm gì ngay sau khi xem kết quả.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            <LinkButton href={routes.studyPlan} className="w-full justify-between">
              Review mistakes in study plan
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.practiceExam(exam.id)} variant="secondary" className="w-full justify-between">
              Retry practice exam
              <RotateCcw className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.tutor} variant="outline" className="w-full justify-between">
              Ask Tutor about missed concepts
              <Bot className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.analytics} variant="outline" className="w-full justify-between">
              Open analytics dashboard
              <Target className="h-4 w-4" />
            </LinkButton>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Topic breakdown</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Mỗi topic đều có tóm tắt văn bản để không phụ thuộc vào màu của biểu đồ.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <BarChart
              data={topicChart}
              summary={`Topic yếu nhất hiện tại: ${getRetryPriorityText(attempt)}`}
            />
            <p className="text-sm leading-6 text-ink-600">{getRetryPriorityText(attempt)}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Readiness impact</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Kết quả thi thử nên nối về readiness thay vì chỉ dừng ở score.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3 text-sm text-ink-600">
                <span>Current readiness</span>
                <span className="font-medium text-ink-900">{exam.readinessPct}%</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={exam.readinessPct} tone="brand" />
              </div>
            </div>
            <div className="rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3 text-sm text-ink-600">
                <span>Result-informed mastery estimate</span>
                <span className="font-medium text-ink-900">{masteryEstimate}%</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={masteryEstimate} tone="mastery" />
              </div>
            </div>
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
              Practice exam này xác nhận rằng nhóm Định thời CPU đã khá ổn, nhưng bạn vẫn cần một vòng review sâu cho Đồng bộ tiến trình trước khi tăng độ khó hoặc giảm thời gian làm bài.
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">Per-question review</h2>
          <p className="mt-1 text-sm text-ink-600">
            Mỗi câu đều hiển thị đáp án bạn chọn, đáp án đúng, giải thích và citation để sửa lỗi theo đúng nguồn.
          </p>
        </div>

        <div className="space-y-4">
          {questionReviewItems.map((item) => (
            <Card key={item.question.id}>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={item.correct ? "success" : "error"}>
                        {item.correct ? "Correct" : "Incorrect"}
                      </Badge>
                      <Badge tone="neutral">{item.question.topic}</Badge>
                      <Badge tone="neutral">Question {item.question.ordinal}</Badge>
                    </div>
                    <CardTitle className="mt-3 text-lg">{item.question.stem}</CardTitle>
                  </div>
                  {item.correct ? (
                    <CircleCheck className="h-6 w-6 text-success-600" />
                  ) : (
                    <CircleX className="h-6 w-6 text-error-600" />
                  )}
                </div>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-ink-100 p-4">
                    <p className="text-sm font-medium text-ink-500">Your answer</p>
                    <p className="mt-2 text-sm font-semibold text-ink-900">
                      {item.selectedOption?.text ?? "Chưa chọn đáp án"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-success-100 bg-success-50 p-4">
                    <p className="text-sm font-medium text-success-700">Correct answer</p>
                    <p className="mt-2 text-sm font-semibold text-success-900">{item.correctOption.text}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-ink-100 p-4">
                  <p className="text-sm font-medium text-ink-700">Explanation</p>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{item.question.explanation}</p>
                </div>

                <CitationSnippet citation={item.question.citation} />

                <div className="flex flex-wrap gap-2">
                  <LinkButton href={routes.document(item.question.citation.documentId)} variant="outline" size="sm">
                    <BookOpen className="h-4 w-4" />
                    View source
                  </LinkButton>
                  <LinkButton href={routes.tutor} variant="outline" size="sm">
                    <Bot className="h-4 w-4" />
                    Ask Tutor
                  </LinkButton>
                  <Link
                    href={routes.studyPlan}
                    className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
                  >
                    Add to review queue
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
