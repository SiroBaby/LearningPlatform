import { AlertTriangle, BookOpenCheck, CalendarClock, Clock3, ListTodo } from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CitationBadge,
  EmptyState,
  LinkButton,
  ProgressBar,
  SectionHeading,
} from "@/components/ui";
import { courses, decks, documents, studyTasks } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Course, Flashcard, FlashcardDeck, LearningDocument, StudyTask } from "@/lib/types";

const REVIEWABLE_DUE_STATES = new Set(["due", "overdue", "new", "upcoming"] as const);
const MINUTES_PER_CARD = 2;

interface ReviewQueueCard {
  readonly card: Flashcard;
  readonly deck: FlashcardDeck;
  readonly document: LearningDocument;
  readonly course?: Course;
}

interface ReviewBucketSummary {
  readonly dueTodayCount: number;
  readonly overdueCount: number;
  readonly upcomingCount: number;
  readonly estimatedMinutes: number;
}

interface BreakdownEntry {
  readonly id: string;
  readonly label: string;
  readonly secondaryLabel: string;
  readonly reviewableCount: number;
  readonly overdueCount: number;
  readonly dueTodayCount: number;
  readonly upcomingCount: number;
  readonly masteryPct?: number;
  readonly href: string;
}

export function ReviewPageContent() {
  const reviewQueueCards = buildReviewQueueCards();
  const reviewSummary = buildReviewBucketSummary(reviewQueueCards);
  const reviewTasks = studyTasks.filter((task) => !task.done);
  const courseBreakdown = buildCourseBreakdown(reviewQueueCards);
  const documentBreakdown = buildDocumentBreakdown(reviewQueueCards);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Due today"
          value={String(reviewSummary.dueTodayCount)}
          description="Thẻ đã đến hạn đúng hôm nay."
          icon={BookOpenCheck}
          toneClassName="bg-brand-50 text-brand-700"
        />
        <MetricCard
          title="Overdue"
          value={String(reviewSummary.overdueCount)}
          description="Ưu tiên xử lý trước khi bắt đầu quiz mới."
          icon={AlertTriangle}
          toneClassName="bg-error-50 text-error-700"
        />
        <MetricCard
          title="Upcoming"
          value={String(reviewSummary.upcomingCount)}
          description="Thẻ mới hoặc sắp vào phiên ôn kế tiếp."
          icon={CalendarClock}
          toneClassName="bg-review-50 text-review-600"
        />
        <MetricCard
          title="Estimated time"
          value={formatMinutes(reviewSummary.estimatedMinutes)}
          description="Tổng thời gian ước tính cho hàng đợi hiện tại."
          icon={Clock3}
          toneClassName="bg-success-50 text-success-700"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="Today’s queue"
              title="Review ngay các thẻ cần quay lại"
              description="Hàng đợi gom thẻ đến hạn, thẻ quá hạn, và thẻ mới cần mở phiên đầu tiên."
            />
          </CardHeader>
          <CardBody className="space-y-4">
            {reviewQueueCards.length > 0 ? (
              reviewQueueCards.map((entry) => (
                <ReviewQueueRow key={entry.card.id} entry={entry} />
              ))
            ) : (
              <EmptyState
                icon={BookOpenCheck}
                title="Không có thẻ cần ôn"
                description="Bạn đang bắt kịp review queue. Hãy chuyển sang quiz hoặc mở Tutor để đào sâu phần khó."
                action={<LinkButton href={routes.home}>Về dashboard</LinkButton>}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="Recommended tasks"
              title="Những việc nên làm tiếp theo"
              description="Các task còn mở được kéo từ study plan mock để bạn có lộ trình rõ ràng."
            />
          </CardHeader>
          <CardBody className="space-y-3">
            {reviewTasks.map((task) => (
              <ReviewTaskRow key={task.id} task={task} />
            ))}
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <BreakdownCard
          title="Course breakdown"
          description="Xem course nào đang kéo review queue của bạn lên cao nhất."
          entries={courseBreakdown}
        />
        <BreakdownCard
          title="Document breakdown"
          description="Tài liệu nào đang tạo nhiều thẻ quá hạn hoặc thẻ mới nhất."
          entries={documentBreakdown}
        />
      </section>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  toneClassName,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  toneClassName: string;
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{title}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
          </div>
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneClassName}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="text-sm leading-6 text-ink-600">{description}</p>
      </CardBody>
    </Card>
  );
}

function ReviewQueueRow({ entry }: { entry: ReviewQueueCard }) {
  const dueLabel = getDueLabel(entry.card);
  const dueTone = getDueTone(entry.card);

  return (
    <div className="rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={dueTone}>{dueLabel}</Badge>
            <Badge tone="neutral">{entry.card.topic}</Badge>
            <Badge tone="mastery">{entry.deck.title}</Badge>
          </div>
          <div>
            <h3 className="text-base font-semibold text-ink-900">{entry.card.front}</h3>
            <p className="mt-1 text-sm leading-6 text-ink-600">{entry.card.back}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <span>{entry.document.title}</span>
            {entry.course ? <span>· {entry.course.name}</span> : null}
          </div>
          <CitationBadge citation={entry.card.citation} />
        </div>

        <div className="flex w-full flex-col gap-3 lg:max-w-52">
          <LinkButton href={routes.deckReview(entry.deck.id)} className="justify-center">
            Review now
          </LinkButton>
          <LinkButton href={routes.deck(entry.deck.id)} variant="outline" className="justify-center">
            Open deck
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

function ReviewTaskRow({ task }: { task: StudyTask }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <ListTodo className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-900">{task.title}</p>
            <Badge tone="neutral">{taskTypeLabel(task.type)}</Badge>
          </div>
          {task.documentTitle ? (
            <p className="mt-1 text-sm leading-6 text-ink-600">{task.documentTitle}</p>
          ) : null}
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-ink-400">
            {formatMinutes(task.estimatedMinutes)}
          </p>
        </div>
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  description,
  entries,
}: {
  title: string;
  description: string;
  entries: readonly BreakdownEntry[];
}) {
  return (
    <Card>
      <CardHeader>
        <SectionHeading title={title} description={description} eyebrow="Queue insight" />
      </CardHeader>
      <CardBody className="space-y-4">
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div>
                  <h3 className="text-base font-semibold text-ink-900">{entry.label}</h3>
                  <p className="mt-1 text-sm text-ink-600">{entry.secondaryLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="brand">Due today · {entry.dueTodayCount}</Badge>
                  <Badge tone="error">Overdue · {entry.overdueCount}</Badge>
                  <Badge tone="review">Upcoming · {entry.upcomingCount}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <LinkButton href={entry.href} variant="outline" size="sm">
                  Open
                </LinkButton>
              </div>
            </div>
            {typeof entry.masteryPct === "number" ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-600">Current mastery</span>
                  <span className="font-medium text-ink-900">{entry.masteryPct}%</span>
                </div>
                <ProgressBar value={entry.masteryPct} tone="mastery" />
              </div>
            ) : null}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function buildReviewQueueCards(): ReviewQueueCard[] {
  const entries: ReviewQueueCard[] = [];

  for (const deck of decks) {
    const document = documents.find((item) => item.id === deck.documentId);
    if (!document) {
      continue;
    }

    const course = document.courseId ? courses.find((item) => item.id === document.courseId) : undefined;
    const reviewableCards = deck.cards.filter(
      (card) => card.dueState !== "mastered" && REVIEWABLE_DUE_STATES.has(card.dueState),
    );

    for (const card of reviewableCards) {
      entries.push({ card, deck, document, course });
    }
  }

  return sortReviewQueueCards(entries);
}

function sortReviewQueueCards(entries: readonly ReviewQueueCard[]): ReviewQueueCard[] {
  const rankByState: Record<Flashcard["dueState"], number> = {
    overdue: 0,
    due: 1,
    upcoming: 2,
    new: 3,
    mastered: 4,
  };

  return [...entries].sort((left, right) => rankByState[left.card.dueState] - rankByState[right.card.dueState]);
}

function buildReviewBucketSummary(entries: readonly ReviewQueueCard[]): ReviewBucketSummary {
  const dueTodayCount = entries.filter((entry) => entry.card.dueState === "due").length;
  const overdueCount = entries.filter((entry) => entry.card.dueState === "overdue").length;
  const upcomingCount = entries.filter(
    (entry) => entry.card.dueState === "upcoming" || entry.card.dueState === "new",
  ).length;
  const estimatedMinutes = Math.max(
    entries.length * MINUTES_PER_CARD,
    studyTasks.filter((task) => !task.done).reduce((total, task) => total + task.estimatedMinutes, 0),
  );

  return {
    dueTodayCount,
    overdueCount,
    upcomingCount,
    estimatedMinutes,
  };
}

function buildCourseBreakdown(entries: readonly ReviewQueueCard[]): BreakdownEntry[] {
  const grouped = new Map<string, ReviewQueueCard[]>();

  for (const entry of entries) {
    const courseId = entry.course?.id ?? "uncategorized";
    const existingEntries = grouped.get(courseId) ?? [];
    existingEntries.push(entry);
    grouped.set(courseId, existingEntries);
  }

  return [...grouped.entries()].map(([courseId, queueEntries]) => {
    const course = queueEntries[0]?.course;
    const label = course?.name ?? "Unassigned review";
    const secondaryLabel = course
      ? `${queueEntries.length} cards từ ${queueEntries.length > 1 ? "nhiều tài liệu" : "1 tài liệu"}`
      : "Cards chưa gán course";

    return {
      id: courseId,
      label,
      secondaryLabel,
      reviewableCount: queueEntries.length,
      overdueCount: queueEntries.filter((entry) => entry.card.dueState === "overdue").length,
      dueTodayCount: queueEntries.filter((entry) => entry.card.dueState === "due").length,
      upcomingCount: queueEntries.filter(
        (entry) => entry.card.dueState === "upcoming" || entry.card.dueState === "new",
      ).length,
      masteryPct: course?.masteryPct,
      href: course ? routes.course(course.id) : routes.review,
    } satisfies BreakdownEntry;
  });
}

function buildDocumentBreakdown(entries: readonly ReviewQueueCard[]): BreakdownEntry[] {
  const grouped = new Map<string, ReviewQueueCard[]>();

  for (const entry of entries) {
    const existingEntries = grouped.get(entry.document.id) ?? [];
    existingEntries.push(entry);
    grouped.set(entry.document.id, existingEntries);
  }

  return [...grouped.entries()].map(([documentId, queueEntries]) => {
    const document = queueEntries[0].document;
    const course = queueEntries[0].course;

    return {
      id: documentId,
      label: document.title,
      secondaryLabel: course ? `Trong course: ${course.name}` : "Chưa gán vào course",
      reviewableCount: queueEntries.length,
      overdueCount: queueEntries.filter((entry) => entry.card.dueState === "overdue").length,
      dueTodayCount: queueEntries.filter((entry) => entry.card.dueState === "due").length,
      upcomingCount: queueEntries.filter(
        (entry) => entry.card.dueState === "upcoming" || entry.card.dueState === "new",
      ).length,
      masteryPct: document.masteryPct,
      href: routes.deck(queueEntries[0].deck.id),
    } satisfies BreakdownEntry;
  });
}

function formatMinutes(totalMinutes: number): string {
  return `${totalMinutes} min`;
}

function getDueLabel(card: Flashcard): string {
  if (card.dueState === "overdue") {
    return "Overdue";
  }
  if (card.dueState === "due") {
    return "Due today";
  }
  if (card.dueState === "upcoming") {
    return "Upcoming";
  }
  return "New";
}

function getDueTone(card: Flashcard): "brand" | "error" | "review" | "neutral" {
  if (card.dueState === "overdue") {
    return "error";
  }
  if (card.dueState === "due") {
    return "brand";
  }
  if (card.dueState === "upcoming") {
    return "review";
  }
  return "neutral";
}

function taskTypeLabel(taskType: StudyTask["type"]): string {
  const labelMap: Record<StudyTask["type"], string> = {
    flashcards: "Flashcards",
    retry_quiz: "Retry quiz",
    video_checkpoint: "Video checkpoint",
    read_source: "Read source",
    ask_tutor: "Ask tutor",
    practice_exam: "Practice exam",
  };

  return labelMap[taskType];
}
