import Link from "next/link";
import { BookOpenCheck, Filter, Layers3, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Course, Difficulty, Flashcard, FlashcardDeck, LearningDocument } from "@/lib/types";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationBadge,
  DifficultyBadge,
  EmptyState,
  LinkButton,
  ProgressBar,
  SectionHeading,
} from "@/components/ui";

interface DeckFilterState {
  readonly topic?: string;
  readonly difficulty?: Difficulty;
  readonly due?: Flashcard["dueState"];
}

const DUE_FILTER_OPTIONS: ReadonlyArray<Flashcard["dueState"]> = [
  "due",
  "overdue",
  "new",
  "upcoming",
  "mastered",
];

export function DeckPageContent({
  deck,
  document,
  course,
  filters,
}: {
  deck: FlashcardDeck;
  document: LearningDocument;
  course?: Course;
  filters: DeckFilterState;
}) {
  const filteredCards = filterCards(deck.cards, filters);
  const topicOptions = getTopicOptions(deck.cards);
  const difficultyOptions = getDifficultyOptions(deck.cards);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardBody className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">Deck</Badge>
              <Badge tone="neutral">{document.title}</Badge>
              {course ? <Badge tone="mastery">{course.name}</Badge> : null}
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{deck.title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600 sm:text-base">
                Học theo spaced repetition với nguồn gốc rõ ràng. Mỗi thẻ đều gắn với citation để bạn quay lại đúng trang hoặc đoạn đã học.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryTile label="Card count" value={String(deck.total)} />
              <SummaryTile label="Due cards" value={String(deck.dueCount)} />
              <SummaryTile label="New cards" value={String(deck.newCount)} />
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={routes.deckReview(deck.id)}>Start review</LinkButton>
              <LinkButton href={routes.review} variant="outline">
                Open review queue
              </LinkButton>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="Mastery snapshot"
              title="Tiến độ trong tài liệu nguồn"
              description="Deck không đứng riêng lẻ; nó phản ánh độ hiểu của bạn với document gốc."
            />
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-600">Document mastery</span>
                <span className="font-medium text-ink-900">{document.masteryPct ?? 0}%</span>
              </div>
              <ProgressBar value={document.masteryPct ?? 0} tone="mastery" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <DetailTile label="Mastered cards" value={String(deck.masteredCount)} />
              <DetailTile label="Last studied" value={document.lastStudiedAt ? formatDate(document.lastStudiedAt) : "Chưa học"} />
            </div>
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <SectionHeading
            eyebrow="Filters"
            title="Lọc thẻ theo topic, difficulty, và due date"
            description="Giữ trạng thái filter trong URL để bạn refresh hoặc share mà không mất ngữ cảnh."
            action={
              <LinkButton href={routes.deck(deck.id)} variant="outline" size="sm">
                Clear filters
              </LinkButton>
            }
          />
        </CardHeader>
        <CardBody className="space-y-5">
          <FilterGroup
            title="Topic"
            icon={Layers3}
            options={topicOptions}
            activeValue={filters.topic}
            hrefBuilder={(value) => buildDeckHref(deck.id, { ...filters, topic: value })}
            clearHref={buildDeckHref(deck.id, { ...filters, topic: undefined })}
          />
          <FilterGroup
            title="Difficulty"
            icon={Filter}
            options={difficultyOptions.map((value) => ({ value, label: difficultyLabel(value) }))}
            activeValue={filters.difficulty}
            hrefBuilder={(value) => buildDeckHref(deck.id, { ...filters, difficulty: value as Difficulty })}
            clearHref={buildDeckHref(deck.id, { ...filters, difficulty: undefined })}
          />
          <FilterGroup
            title="Due date"
            icon={BookOpenCheck}
            options={DUE_FILTER_OPTIONS.map((value) => ({ value, label: dueStateLabel(value) }))}
            activeValue={filters.due}
            hrefBuilder={(value) => buildDeckHref(deck.id, { ...filters, due: value as Flashcard["dueState"] })}
            clearHref={buildDeckHref(deck.id, { ...filters, due: undefined })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading
            eyebrow="Cards"
            title="Deck preview"
            description={`Hiển thị ${filteredCards.length} / ${deck.cards.length} thẻ khớp với filter hiện tại.`}
          />
        </CardHeader>
        <CardBody className="space-y-4">
          {filteredCards.length > 0 ? (
            filteredCards.map((card) => <DeckCardPreview key={card.id} card={card} />)
          ) : (
            <EmptyState
              icon={Sparkles}
              title="Không có thẻ nào khớp"
              description="Hãy đổi filter hoặc quay lại toàn bộ deck để tiếp tục review."
              action={<LinkButton href={routes.deck(deck.id)}>Xem toàn bộ deck</LinkButton>}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-ink-900">{value}</p>
    </div>
  );
}

function FilterGroup({
  title,
  icon: Icon,
  options,
  activeValue,
  hrefBuilder,
  clearHref,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  options: ReadonlyArray<{ value: string; label: string }>;
  activeValue?: string;
  hrefBuilder: (value: string) => string;
  clearHref: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
        <Icon className="h-4 w-4 text-brand-600" />
        <span>{title}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <FilterChip href={clearHref} active={!activeValue} label="All" />
        {options.map((option) => (
          <FilterChip
            key={option.value}
            href={hrefBuilder(option.value)}
            active={activeValue === option.value}
            label={option.label}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50 hover:text-ink-900",
      )}
      aria-current={active ? "true" : undefined}
    >
      {label}
    </Link>
  );
}

function DeckCardPreview({ card }: { card: Flashcard }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={dueStateTone(card.dueState)}>{dueStateLabel(card.dueState)}</Badge>
            <DifficultyBadge difficulty={card.difficulty} />
            <Badge tone="neutral">{card.topic}</Badge>
          </div>
          <div>
            <CardTitle>Front</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-700">{card.front}</p>
          </div>
          <div>
            <CardTitle>Back</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">{card.back}</p>
          </div>
          <CitationBadge citation={card.citation} />
        </div>
      </div>
    </div>
  );
}

function filterCards(cards: readonly Flashcard[], filters: DeckFilterState): Flashcard[] {
  return cards.filter((card) => {
    if (filters.topic && card.topic !== filters.topic) {
      return false;
    }
    if (filters.difficulty && card.difficulty !== filters.difficulty) {
      return false;
    }
    if (filters.due && card.dueState !== filters.due) {
      return false;
    }
    return true;
  });
}

function getTopicOptions(cards: readonly Flashcard[]): Array<{ value: string; label: string }> {
  return [...new Set(cards.map((card) => card.topic))].map((topic) => ({
    value: topic,
    label: topic,
  }));
}

function getDifficultyOptions(cards: readonly Flashcard[]): Difficulty[] {
  return [...new Set(cards.map((card) => card.difficulty))];
}

function buildDeckHref(deckId: string, filters: DeckFilterState): string {
  const params = new URLSearchParams();

  if (filters.topic) {
    params.set("topic", filters.topic);
  }
  if (filters.difficulty) {
    params.set("difficulty", filters.difficulty);
  }
  if (filters.due) {
    params.set("due", filters.due);
  }

  const queryString = params.toString();
  return queryString ? `${routes.deck(deckId)}?${queryString}` : routes.deck(deckId);
}

function difficultyLabel(difficulty: Difficulty): string {
  const labelMap: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  };

  return labelMap[difficulty];
}

function dueStateLabel(dueState: Flashcard["dueState"]): string {
  const labelMap: Record<Flashcard["dueState"], string> = {
    due: "Due today",
    overdue: "Overdue",
    new: "New",
    upcoming: "Upcoming",
    mastered: "Mastered",
  };

  return labelMap[dueState];
}

function dueStateTone(dueState: Flashcard["dueState"]): "brand" | "error" | "neutral" | "review" | "mastery" {
  const toneMap: Record<Flashcard["dueState"], "brand" | "error" | "neutral" | "review" | "mastery"> = {
    due: "brand",
    overdue: "error",
    new: "neutral",
    upcoming: "review",
    mastered: "mastery",
  };

  return toneMap[dueState];
}
