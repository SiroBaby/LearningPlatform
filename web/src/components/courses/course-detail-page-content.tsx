import { BookOpenCheck, Bot, CalendarClock, FileStack, Sparkles, Target } from "lucide-react";
import {
  Badge,
  BarChart,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationBadge,
  LinkButton,
  ProgressBar,
  SectionHeading,
} from "@/components/ui";
import { formatDate } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Attempt, Course, Exam, FlashcardDeck, LearningDocument, Quiz, StudyTask, WeakTopic } from "@/lib/types";

const OUTPUT_LABELS = {
  quiz: "Bài kiểm tra",
  flashcards: "Thẻ ghi nhớ",
  tutor: "Trợ giảng",
  checkpoints: "Điểm dừng",
} as const;

function getOutputLabels(outputs: ReadonlyArray<keyof typeof OUTPUT_LABELS>): string {
  return outputs.map((output) => OUTPUT_LABELS[output]).join(", ");
}

export function CourseDetailPageContent({
  course,
  documents,
  quizzes,
  attempts,
  decks,
  studyTasks,
  weakTopics,
  exam,
}: {
  course: Course;
  documents: readonly LearningDocument[];
  quizzes: readonly Quiz[];
  attempts: readonly Attempt[];
  decks: readonly FlashcardDeck[];
  studyTasks: readonly StudyTask[];
  weakTopics: readonly WeakTopic[];
  exam?: Exam;
}) {
  const totalQuestionCount = quizzes.reduce((total, quiz) => total + quiz.questionCount, 0);
  const totalDueCards = decks.reduce((total, deck) => total + deck.dueCount, 0);
  const attemptAverage = attempts.length
    ? Math.round(attempts.reduce((total, attempt) => total + attempt.scorePct, 0) / attempts.length)
    : 0;

  return (
    <div className="space-y-8">
      <section id="overview" className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardBody className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{course.subject}</Badge>
              <Badge tone="neutral">{course.language}</Badge>
              {course.deadline ? <Badge tone="review">Hạn chót · {formatDate(course.deadline)}</Badge> : null}
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{course.name}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600 sm:text-base">
                {course.goal
                  ? `${course.goal}. Khóa học này gom tài liệu, câu hỏi, thẻ ghi nhớ, trợ giảng và ôn thi quanh cùng một mục tiêu học.`
                  : "Khóa học này gom tài liệu, câu hỏi, thẻ ghi nhớ, trợ giảng và ôn thi quanh cùng một mục tiêu học."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewStat label="Tài liệu" value={String(documents.length)} icon={FileStack} />
              <OverviewStat label="Bài kiểm tra" value={String(quizzes.length)} icon={BookOpenCheck} />
              <OverviewStat label="Lượt ôn đến hạn" value={String(course.dueReviews)} icon={Sparkles} />
              <OverviewStat label="Mức ghi nhớ" value={`${course.masteryPct}%`} icon={Target} />
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`${routes.tutor}?context=${encodeURIComponent(`course:${course.id}`)}`}>
                Hỏi trợ giảng theo khóa học
              </LinkButton>
              <LinkButton href={routes.review} variant="outline">
                Ôn thẻ đến hạn
              </LinkButton>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="Tình hình khóa học"
              title="Tổng quan trước khi bắt đầu"
              description="Xem nhanh để biết nên làm bài kiểm tra, ôn thẻ ghi nhớ hay hỏi trợ giảng."
            />
          </CardHeader>
          <CardBody className="space-y-4">
            <MetricTile label="Câu hỏi đã tạo" value={`${totalQuestionCount} câu`} />
            <MetricTile label="Thẻ đến hạn" value={`${totalDueCards} thẻ`} />
            <MetricTile label="Điểm trung bình" value={`${attemptAverage}%`} />
            <MetricTile
              label="Last studied"
              value={course.lastStudiedAt ? formatDate(course.lastStudiedAt) : "Chưa học"}
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-600">Mức ghi nhớ chung</span>
                <span className="font-medium text-ink-900">{course.masteryPct}%</span>
              </div>
              <ProgressBar value={course.masteryPct} tone="mastery" />
            </div>
          </CardBody>
        </Card>
      </section>

      <section id="documents" className="space-y-4">
        <SectionHeading
          eyebrow="Tài liệu"
          title="Nguồn học trong khóa này"
          description="Mỗi tài liệu là nguồn cho bài kiểm tra, thẻ ghi nhớ, trợ giảng và trích dẫn liên quan."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {documents.map((document) => (
            <Card key={document.id}>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{document.type.toUpperCase()}</Badge>
                  <Badge tone="neutral">Nội dung: {getOutputLabels(document.outputs)}</Badge>
                </div>
                <div>
                  <CardTitle>{document.title}</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    Ghi nhớ {document.masteryPct ?? 0}% · Học gần nhất {document.lastStudiedAt ? formatDate(document.lastStudiedAt) : "Chưa học"}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-600">Mức ghi nhớ theo tài liệu</span>
                    <span className="font-medium text-ink-900">{document.masteryPct ?? 0}%</span>
                  </div>
                  <ProgressBar value={document.masteryPct ?? 0} tone="brand" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section id="study-plan" className="space-y-4">
        <SectionHeading
          eyebrow="Kế hoạch học"
          title="Việc nên làm tiếp"
          description="Kế hoạch học gom thẻ ghi nhớ, câu hỏi làm lại và trợ giảng tiếp nối dựa trên những gì còn yếu trong khóa."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {studyTasks.map((task) => (
            <Card key={task.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={task.done ? "success" : "review"}>{task.done ? "Đã xong" : "Chưa làm"}</Badge>
                  <Badge tone="neutral">{task.type}</Badge>
                </div>
                <div>
                  <CardTitle>{task.title}</CardTitle>
                  {task.documentTitle ? (
                    <p className="mt-2 text-sm leading-6 text-ink-600">{task.documentTitle}</p>
                  ) : null}
                </div>
                <p className="text-sm font-medium text-ink-900">Thời gian dự kiến · {task.estimatedMinutes} phút</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section id="quizzes" className="space-y-4">
        <SectionHeading
          eyebrow="Bài kiểm tra"
          title="Mức bao phủ câu hỏi trong khóa"
          description="Mỗi bài kiểm tra gắn với một tài liệu nguồn, lịch sử làm bài và các chủ đề được bao phủ."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {quizzes.map((quiz) => {
            const latestAttempt = attempts.find((attempt) => attempt.quizId === quiz.id);
            return (
              <Card key={quiz.id}>
                <CardBody className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{quiz.questionCount} câu</Badge>
                    <Badge tone="neutral">{quiz.estimatedMinutes} phút</Badge>
                  </div>
                  <div>
                    <CardTitle>{quiz.title}</CardTitle>
                    <p className="mt-2 text-sm leading-6 text-ink-600">{quiz.documentTitle}</p>
                  </div>
                  <p className="text-sm leading-6 text-ink-700">Chủ đề: {quiz.coverageTopics.join(", ")}</p>
                  {latestAttempt ? (
                    <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
                      <p className="text-sm font-medium text-ink-900">Lần làm gần nhất · {latestAttempt.scorePct}%</p>
                      <p className="mt-1 text-sm leading-6 text-ink-600">
                        {latestAttempt.correctCount}/{latestAttempt.totalCount} câu đúng · Chế độ {latestAttempt.mode}
                      </p>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="flashcards" className="space-y-4">
        <SectionHeading
          eyebrow="Thẻ ghi nhớ"
          title="Bộ thẻ giúp ôn tập trong khóa"
          description="Dùng bộ thẻ khi bạn cần củng cố trí nhớ trước khi quay lại câu hỏi hoặc luyện đề."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {decks.map((deck) => (
            <Card key={deck.id}>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">Đến hạn · {deck.dueCount}</Badge>
                  <Badge tone="neutral">Mới · {deck.newCount}</Badge>
                  <Badge tone="mastery">Đã nhớ · {deck.masteredCount}</Badge>
                </div>
                <div>
                  <CardTitle>{deck.title}</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{deck.documentTitle}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <LinkButton href={routes.deck(deck.id)}>Mở bộ thẻ</LinkButton>
                  <LinkButton href={routes.deckReview(deck.id)} variant="outline">
                    Bắt đầu ôn
                  </LinkButton>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section id="tutor" className="space-y-4">
        <SectionHeading
          eyebrow="Trợ giảng"
          title="Trợ giảng theo ngữ cảnh khóa học"
          description="Ngữ cảnh này chỉ giới hạn trên các tài liệu trong khóa, để trích dẫn và trạng thái thiếu nguồn luôn đáng tin."
        />
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <Bot className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <CardTitle>Hỏi trợ giảng về {course.name}</CardTitle>
                <p className="text-sm leading-6 text-ink-600">
                  Khi mở trợ giảng từ đây, trợ giảng chỉ đọc {documents.length} tài liệu thuộc khóa này. Nếu câu hỏi vượt ra ngoài phạm vi đó, hệ thống sẽ báo thiếu nguồn thay vì trả lời mơ hồ.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`${routes.tutor}?context=${encodeURIComponent(`course:${course.id}`)}`}>
                Mở trợ giảng
              </LinkButton>
              <LinkButton href={routes.review} variant="outline">
                Quay lại danh sách ôn tập
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </section>

      <section id="analytics" className="space-y-4">
        <SectionHeading
          eyebrow="Tiến độ học"
          title="Tín hiệu chủ đề cần củng cố trong khóa"
          description="Không chỉ nhìn màu sắc: luôn có summary văn bản để bạn biết điểm yếu đang nằm ở đâu."
        />
        <Card>
          <CardBody className="space-y-6">
            <BarChart
              data={weakTopics.map((topic) => ({
                label: topic.name,
                value: topic.masteryPct,
                tone: topic.masteryPct < 50 ? "error" : "warning",
              }))}
              summary={`Mức ghi nhớ thấp nhất trong khóa học là ${weakTopics
                .map((topic) => `${topic.name} ${topic.masteryPct}%`)
                .join(", ")}.`}
            />
            <div className="grid gap-4 xl:grid-cols-2">
              {weakTopics.map((topic) => (
                <div key={topic.id} className="rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                    <Badge tone="review">Ghi nhớ {topic.masteryPct}%</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    Câu bỏ lỡ: {topic.missedQuestions}. Xem lại trích dẫn gốc rồi làm lại câu hỏi để tránh học thuộc đáp án mà không hiểu nguyên lý.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {topic.citations.map((citation) => (
                      <CitationBadge key={citation.chunkId} citation={citation} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </section>

      <section id="exam-prep" className="space-y-4">
        <SectionHeading
          eyebrow="Ôn thi"
          title="Đưa khóa học vào chế độ ôn thi"
          description="Nếu đã có kỳ thi, mục này cho biết ngày thi, mức sẵn sàng và việc cần ôn tiếp theo."
        />
        {exam ? <ExamPrepCard exam={exam} /> : <ExamPrepEmptyState courseName={course.name} />}
      </section>
    </div>
  );
}

function OverviewStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-ink-900">{value}</p>
    </div>
  );
}

function ExamPrepCard({ exam }: { exam: Exam }) {
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">Đã thiết lập kỳ thi</Badge>
          <Badge tone="review">Ngày thi · {formatDate(exam.date)}</Badge>
        </div>
        <div>
          <CardTitle>{exam.name}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            Mục tiêu {exam.targetScorePct}% · Mức sẵn sàng hiện tại {exam.readinessPct}%.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-600">Mức sẵn sàng</span>
            <span className="font-medium text-ink-900">{exam.readinessPct}%</span>
          </div>
          <ProgressBar value={exam.readinessPct} tone="review" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Tài liệu" value={String(exam.documentIds.length)} />
          <MetricTile label="Điểm mục tiêu" value={`${exam.targetScorePct}%`} />
          <MetricTile label="Việc nên làm" value="Ôn chủ đề yếu → thẻ ghi nhớ → làm lại câu hỏi" />
        </div>
      </CardBody>
    </Card>
  );
}

function ExamPrepEmptyState({ courseName }: { courseName: string }) {
  return (
    <Card>
      <CardBody className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-review-50 text-review-600">
          <CalendarClock className="h-5 w-5" />
        </div>
        <div>
          <CardTitle>Chưa có kế hoạch ôn thi cho {courseName}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            Khi bạn đặt ngày thi và điểm mục tiêu, mục này sẽ hiển thị mức sẵn sàng, phần kiến thức đã bao phủ và đề luyện tập.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
