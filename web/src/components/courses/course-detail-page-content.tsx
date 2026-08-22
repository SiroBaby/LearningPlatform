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
              {course.deadline ? <Badge tone="review">Deadline · {formatDate(course.deadline)}</Badge> : null}
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{course.name}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600 sm:text-base">
                {course.goal
                  ? `${course.goal}. Course này gom tài liệu, quiz, flashcards, tutor context, và exam prep quanh cùng một mục tiêu học.`
                  : "Course này gom tài liệu, quiz, flashcards, tutor context, và exam prep quanh cùng một mục tiêu học."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewStat label="Documents" value={String(documents.length)} icon={FileStack} />
              <OverviewStat label="Quizzes" value={String(quizzes.length)} icon={BookOpenCheck} />
              <OverviewStat label="Due reviews" value={String(course.dueReviews)} icon={Sparkles} />
              <OverviewStat label="Mastery" value={`${course.masteryPct}%`} icon={Target} />
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`${routes.tutor}?context=${encodeURIComponent(`course:${course.id}`)}`}>
                Open tutor context
              </LinkButton>
              <LinkButton href={routes.review} variant="outline">
                Review due cards
              </LinkButton>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="Course health"
              title="Overview nhanh trước khi bắt đầu"
              description="Dùng snapshot này để biết nên tiếp tục quiz, flashcards, hay đi thẳng vào tutor / exam prep."
            />
          </CardHeader>
          <CardBody className="space-y-4">
            <MetricTile label="Question coverage" value={`${totalQuestionCount} questions`} />
            <MetricTile label="Deck due cards" value={`${totalDueCards} cards`} />
            <MetricTile label="Average attempt score" value={`${attemptAverage}%`} />
            <MetricTile
              label="Last studied"
              value={course.lastStudiedAt ? formatDate(course.lastStudiedAt) : "Chưa học"}
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-600">Overall mastery</span>
                <span className="font-medium text-ink-900">{course.masteryPct}%</span>
              </div>
              <ProgressBar value={course.masteryPct} tone="mastery" />
            </div>
          </CardBody>
        </Card>
      </section>

      <section id="documents" className="space-y-4">
        <SectionHeading
          eyebrow="Documents"
          title="Nguồn học trong course này"
          description="Document vẫn là chủ sở hữu của quiz, flashcards, tutor evidence, và mọi citation."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {documents.map((document) => (
            <Card key={document.id}>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{document.type.toUpperCase()}</Badge>
                  <Badge tone="neutral">Outputs: {document.outputs.join(", ")}</Badge>
                </div>
                <div>
                  <CardTitle>{document.title}</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    Mastery {document.masteryPct ?? 0}% · Last studied {document.lastStudiedAt ? formatDate(document.lastStudiedAt) : "Chưa học"}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-600">Document mastery</span>
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
          eyebrow="Study plan"
          title="Task nên làm tiếp"
          description="Study plan gom flashcards, quiz retry, và tutor follow-up dựa trên những gì còn yếu trong course."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {studyTasks.map((task) => (
            <Card key={task.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={task.done ? "success" : "review"}>{task.done ? "Done" : "Open"}</Badge>
                  <Badge tone="neutral">{task.type}</Badge>
                </div>
                <div>
                  <CardTitle>{task.title}</CardTitle>
                  {task.documentTitle ? (
                    <p className="mt-2 text-sm leading-6 text-ink-600">{task.documentTitle}</p>
                  ) : null}
                </div>
                <p className="text-sm font-medium text-ink-900">Estimated time · {task.estimatedMinutes} min</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section id="quizzes" className="space-y-4">
        <SectionHeading
          eyebrow="Quizzes"
          title="Quiz coverage trong course"
          description="Mỗi quiz gắn với một document nguồn, attempt history, và breakdown theo topic."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {quizzes.map((quiz) => {
            const latestAttempt = attempts.find((attempt) => attempt.quizId === quiz.id);
            return (
              <Card key={quiz.id}>
                <CardBody className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{quiz.questionCount} questions</Badge>
                    <Badge tone="neutral">{quiz.estimatedMinutes} min</Badge>
                  </div>
                  <div>
                    <CardTitle>{quiz.title}</CardTitle>
                    <p className="mt-2 text-sm leading-6 text-ink-600">{quiz.documentTitle}</p>
                  </div>
                  <p className="text-sm leading-6 text-ink-700">Topics: {quiz.coverageTopics.join(", ")}</p>
                  {latestAttempt ? (
                    <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
                      <p className="text-sm font-medium text-ink-900">Latest attempt · {latestAttempt.scorePct}%</p>
                      <p className="mt-1 text-sm leading-6 text-ink-600">
                        {latestAttempt.correctCount}/{latestAttempt.totalCount} correct · {latestAttempt.mode} mode
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
          eyebrow="Flashcards"
          title="Decks kéo review queue của course"
          description="Dùng deck review khi bạn cần củng cố trí nhớ trước khi quay lại quiz hoặc exam mode."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {decks.map((deck) => (
            <Card key={deck.id}>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">Due · {deck.dueCount}</Badge>
                  <Badge tone="neutral">New · {deck.newCount}</Badge>
                  <Badge tone="mastery">Mastered · {deck.masteredCount}</Badge>
                </div>
                <div>
                  <CardTitle>{deck.title}</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{deck.documentTitle}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <LinkButton href={routes.deck(deck.id)}>Open deck</LinkButton>
                  <LinkButton href={routes.deckReview(deck.id)} variant="outline">
                    Start review
                  </LinkButton>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section id="tutor" className="space-y-4">
        <SectionHeading
          eyebrow="Tutor"
          title="Tutor với course context"
          description="Context này chỉ giới hạn trên các document trong course, để citation và no-evidence state luôn đáng tin."
        />
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <Bot className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <CardTitle>Ask Tutor inside {course.name}</CardTitle>
                <p className="text-sm leading-6 text-ink-600">
                  Khi mở Tutor từ đây, assistant chỉ đọc {documents.length} document thuộc course này. Nếu câu hỏi vượt ra ngoài phạm vi đó, no-evidence state sẽ xuất hiện thay vì trả lời mơ hồ.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`${routes.tutor}?context=${encodeURIComponent(`course:${course.id}`)}`}>
                Open tutor
              </LinkButton>
              <LinkButton href={routes.review} variant="outline">
                Return to review queue
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </section>

      <section id="analytics" className="space-y-4">
        <SectionHeading
          eyebrow="Analytics"
          title="Weak-topic signals trong course"
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
              summary={`Mastery thấp nhất hiện tại trong course là ${weakTopics
                .map((topic) => `${topic.name} ${topic.masteryPct}%`)
                .join(", ")}.`}
            />
            <div className="grid gap-4 xl:grid-cols-2">
              {weakTopics.map((topic) => (
                <div key={topic.id} className="rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                    <Badge tone="review">Mastery {topic.masteryPct}%</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    Missed questions: {topic.missedQuestions}. Review citation gốc rồi mới retry quiz để tránh học thuộc đáp án mà không hiểu nguyên lý.
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
          eyebrow="Exam prep"
          title="Kéo course vào chế độ ôn thi"
          description="Nếu exam đã cấu hình, section này cho biết deadline, readiness, và bước ôn nên làm tiếp."
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
          <Badge tone="brand">Exam configured</Badge>
          <Badge tone="review">Date · {formatDate(exam.date)}</Badge>
        </div>
        <div>
          <CardTitle>{exam.name}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            Target score {exam.targetScorePct}% · Readiness hiện tại {exam.readinessPct}%.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-600">Readiness</span>
            <span className="font-medium text-ink-900">{exam.readinessPct}%</span>
          </div>
          <ProgressBar value={exam.readinessPct} tone="review" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Documents" value={String(exam.documentIds.length)} />
          <MetricTile label="Target score" value={`${exam.targetScorePct}%`} />
          <MetricTile label="Suggested action" value="Review weak topics → flashcards → quiz retry" />
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
          <CardTitle>Chưa có exam prep cho {courseName}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            Khi user cấu hình exam date và target score, section này sẽ trở thành điểm vào cho readiness score, coverage map, và practice exam.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
