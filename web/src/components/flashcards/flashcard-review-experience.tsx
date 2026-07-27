"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CitationSnippet, EmptyState, LinkButton, ProgressBar } from "@/components/ui";
import { useToast } from "@/components/ui";
import { routes } from "@/lib/routes";
import type { Flashcard, FlashcardDeck } from "@/lib/types";

interface RatingOption {
  readonly id: "again" | "hard" | "good" | "easy";
  readonly label: string;
  readonly shortcut: string;
  readonly toneClassName: string;
}

const RATING_OPTIONS: readonly RatingOption[] = [
  {
    id: "again",
    label: "Again",
    shortcut: "1",
    toneClassName: "border-error-200 bg-error-50 text-error-700 hover:bg-error-100",
  },
  {
    id: "hard",
    label: "Hard",
    shortcut: "2",
    toneClassName: "border-warning-200 bg-warning-50 text-warning-700 hover:bg-warning-100",
  },
  {
    id: "good",
    label: "Good",
    shortcut: "3",
    toneClassName: "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100",
  },
  {
    id: "easy",
    label: "Easy",
    shortcut: "4",
    toneClassName: "border-success-200 bg-success-50 text-success-700 hover:bg-success-100",
  },
] as const;

export function FlashcardReviewExperience({
  deck,
  reviewCards,
}: {
  deck: FlashcardDeck;
  reviewCards: readonly Flashcard[];
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [ratings, setRatings] = useState<Record<string, RatingOption["id"]>>({});
  const { notify } = useToast();

  const currentCard = reviewCards[currentIndex];
  const reviewedCount = Object.keys(ratings).length;
  const progressValue = reviewCards.length === 0 ? 0 : Math.round((reviewedCount / reviewCards.length) * 100);
  const isComplete = reviewCards.length > 0 && currentIndex >= reviewCards.length;
  const remainingCount = Math.max(reviewCards.length - reviewedCount, 0);

  const reviewSummary = useMemo(() => buildReviewSummary(ratings), [ratings]);

  const handleRateCard = useCallback(
    (rating: RatingOption["id"]) => {
      if (!currentCard) {
        return;
      }

      setRatings((current) => ({
        ...current,
        [currentCard.id]: rating,
      }));
      setIsAnswerVisible(false);
      setCurrentIndex((current) => current + 1);
      notify(`Đã chấm “${currentCard.topic}” là ${rating}.`, "info");
    },
    [currentCard, notify],
  );

  function resetReview() {
    setCurrentIndex(0);
    setIsAnswerVisible(false);
    setRatings({});
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!isComplete) {
          setIsAnswerVisible(true);
        }
      }

      const ratingOption = RATING_OPTIONS.find((option) => option.shortcut === event.key);
      if (!ratingOption || !isAnswerVisible || isComplete || !currentCard) {
        return;
      }

      event.preventDefault();
      handleRateCard(ratingOption.id);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentCard, isAnswerVisible, isComplete, handleRateCard]);

  if (reviewCards.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Không có thẻ cần review"
        description="Deck này hiện không còn thẻ đến hạn. Hãy quay lại review queue hoặc mở deck để xem thẻ đã mastered."
        action={<LinkButton href={routes.review}>Back to review queue</LinkButton>}
        secondaryAction={<LinkButton href={routes.deck(deck.id)} variant="outline">Open deck</LinkButton>}
      />
    );
  }

  if (isComplete || !currentCard) {
    return (
      <div className="space-y-6">
        <Card>
          <CardBody className="space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-50 text-success-700">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Hoàn thành phiên review</h2>
              <p className="mx-auto max-w-2xl text-sm leading-6 text-ink-600 sm:text-base">
                Bạn đã xử lý xong {reviewCards.length} thẻ trong deck này. Hãy dùng breakdown bên dưới để xem card nào cần lặp lại thêm.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {RATING_OPTIONS.map((option) => (
                <div key={option.id} className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{option.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{reviewSummary[option.id]}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => resetReview()}>Restart review</Button>
              <LinkButton href={routes.review} variant="outline">
                Back to review queue
              </LinkButton>
              <LinkButton href={routes.deck(deck.id)} variant="outline">
                Open deck
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">Review progress</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink-900">
                  Card {currentIndex + 1} / {reviewCards.length}
                </h2>
              </div>
              <Badge tone="brand">Remaining · {remainingCount}</Badge>
            </div>
            <ProgressBar value={progressValue} tone="brand" />
          </CardHeader>
          <CardBody className="space-y-6">
            <div className="rounded-[var(--radius-card)] border border-brand-100 bg-brand-50/70 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{currentCard.topic}</Badge>
                <Badge tone="mastery">{currentCard.difficulty}</Badge>
                <Badge tone="review">Shortcut: Space / Enter</Badge>
              </div>
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">Front</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{currentCard.front}</h3>
              </div>
            </div>

            {isAnswerVisible ? (
              <div className="space-y-4 rounded-[var(--radius-card)] border border-success-100 bg-success-50/50 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-success-700">Back</p>
                  <p className="mt-2 text-base leading-7 text-ink-800">{currentCard.back}</p>
                </div>
                <CitationSnippet citation={currentCard.citation} />
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-dashed border-ink-200 bg-ink-50/70 p-5 text-center">
                <p className="text-sm leading-6 text-ink-600">
                  Reveal answer để xem explanation và citation trước khi chấm Again / Hard / Good / Easy.
                </p>
                <div className="mt-4">
                  <Button onClick={() => setIsAnswerVisible(true)}>Reveal answer</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
              <Keyboard className="h-4 w-4 text-brand-600" />
              <span>Rating controls</span>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="space-y-3">
              {RATING_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleRateCard(option.id)}
                  disabled={!isAnswerVisible}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${option.toneClassName}`}
                >
                  <span>{option.label}</span>
                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">{option.shortcut}</span>
                </button>
              ))}
            </div>
            <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
              Space hoặc Enter để reveal. Sau đó dùng phím 1–4 để rate card mà không rời bàn phím.
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setIsAnswerVisible((current) => !current)}>
                {isAnswerVisible ? "Hide answer" : "Reveal answer"}
              </Button>
              <LinkButton href={routes.deck(deck.id)} variant="outline">
                Exit review
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );

}

function buildReviewSummary(ratings: Record<string, RatingOption["id"]>): Record<RatingOption["id"], number> {
  const summary: Record<RatingOption["id"], number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  };

  for (const rating of Object.values(ratings)) {
    summary[rating] += 1;
  }

  return summary;
}
