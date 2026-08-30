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
          title="Cần ôn hôm nay"
          value={String(reviewSummary.dueTodayCount)}
          description="Thẻ đã đến hạn đúng hôm nay."
          icon={BookOpenCheck}
          toneClassName="bg-brand-50 text-brand-700"
        />
        <MetricCard
          title="Đã quá hạn"
          value={String(reviewSummary.overdueCount)}
          description="Ưu tiên xử lý trước khi bắt đầu bài kiểm tra mới."
          icon={AlertTriangle}
          toneClassName="bg-error-50 text-error-700"
        />
        <MetricCard
          title="Sắp đến lượt ôn"
          value={String(reviewSummary.upcomingCount)}
          description="Thẻ mới hoặc sắp vào phiên ôn kế tiếp."
          icon={CalendarClock}
          toneClassName="bg-review-50 text-review-600"
        />
        <MetricCard
          title="Thời gian dự kiến"
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
              eyebrow="Danh sách cần ôn"
              title="Bắt đầu với thẻ cần nhớ lại ngay"
              description="Ưu tiên thẻ quá hạn, rồi đến thẻ cần ôn hôm nay và thẻ mới."
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
                description="Bạn đã hoàn thành phần cần ôn. Hãy tiếp tục với một bài kiểm tra hoặc hỏi trợ giảng về phần khó."
                action={<LinkButton href={routes.home}>Về trang học</LinkButton>}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="Sau khi ôn xong"
              title="Việc học tiếp theo"
              description="Những việc còn lại được sắp theo thứ tự để bạn không phải tự chọn từ đầu."
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
          title="Theo khóa học"
          description="Xem khóa học nào đang cần bạn dành thời gian ôn nhiều nhất."
          entries={courseBreakdown}
        />
        <BreakdownCard
          title="Theo tài liệu"
          description="Xem tài liệu nào có nhiều thẻ quá hạn hoặc thẻ mới nhất."
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
            Ôn ngay
          </LinkButton>
          <LinkButton href={routes.deck(entry.deck.id)} variant="outline" className="justify-center">
            Mở bộ thẻ
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
        <SectionHeading title={title} description={description} eyebrow="Tình hình cần ôn" />
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
                  <Badge tone="brand">Hôm nay · {entry.dueTodayCount}</Badge>
                  <Badge tone="error">Quá hạn · {entry.overdueCount}</Badge>
                  <Badge tone="review">Sắp tới · {entry.upcomingCount}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <LinkButton href={entry.href} variant="outline" size="sm">
                  Mở
                </LinkButton>
              </div>
            </div>
            {typeof entry.masteryPct === "number" ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-600">Mức độ ghi nhớ</span>
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
    const label = course?.name ?? "Ôn tập chưa phân loại";
    const secondaryLabel = course
      ? `${queueEntries.length} thẻ từ ${queueEntries.length > 1 ? "nhiều tài liệu" : "1 tài liệu"}`
      : "Thẻ chưa gán khóa học";

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
      secondaryLabel: course ? `Trong khóa học: ${course.name}` : "Chưa gán vào khóa học",
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
  return `${totalMinutes} phút`;
}

function getDueLabel(card: Flashcard): string {
  if (card.dueState === "overdue") {
    return "Đã quá hạn";
  }
  if (card.dueState === "due") {
    return "Cần ôn hôm nay";
  }
  if (card.dueState === "upcoming") {
    return "Sắp tới";
  }
  return "Mới";
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
    flashcards: "Thẻ ghi nhớ",
    retry_quiz: "Làm lại bài kiểm tra",
    video_checkpoint: "Mốc kiểm tra video",
    read_source: "Đọc lại tài liệu",
    ask_tutor: "Hỏi trợ giảng",
    practice_exam: "Luyện đề",
  };

  return labelMap[taskType];
}
