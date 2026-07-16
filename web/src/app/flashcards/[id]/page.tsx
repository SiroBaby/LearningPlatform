import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { DeckPageContent } from "@/components/flashcards/deck-page-content";
import { LinkButton } from "@/components/ui";
import { courses, documents, getDeck } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Difficulty, Flashcard } from "@/lib/types";

interface DeckSearchParams {
  readonly topic?: string | string[];
  readonly difficulty?: string | string[];
  readonly due?: string | string[];
}

interface DeckFilters {
  readonly topic?: string;
  readonly difficulty?: Difficulty;
  readonly due?: Flashcard["dueState"];
}

export async function generateMetadata(props: PageProps<"/flashcards/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const deck = getDeck(id);

  if (!deck) {
    return {
      title: "Flashcards not found",
    };
  }

  return {
    title: deck.title,
    description: `Deck flashcards cho ${deck.documentTitle}.`,
  };
}

export default async function FlashcardDeckPage(props: PageProps<"/flashcards/[id]">) {
  const { id } = await props.params;
  const searchParams = (await props.searchParams) as DeckSearchParams;
  const deck = getDeck(id);

  if (!deck) {
    notFound();
  }

  const document = documents.find((item) => item.id === deck.documentId);
  if (!document) {
    notFound();
  }

  const course = document.courseId ? courses.find((item) => item.id === document.courseId) : undefined;
  const filters = buildDeckFilters(searchParams);

  return (
    <LearnerShell
      title={deck.title}
      subtitle="Deck page hiển thị số thẻ, due/new/mastered, filter theo topic/difficulty/due state, và CTA vào phiên review."
      actions={
        <>
          <LinkButton href={routes.review} variant="outline">
            Review queue
          </LinkButton>
          <LinkButton href={routes.deckReview(deck.id)}>
            Start review
          </LinkButton>
        </>
      }
    >
      <DeckPageContent deck={deck} document={document} course={course} filters={filters} />
    </LearnerShell>
  );
}

function buildDeckFilters(searchParams: DeckSearchParams): DeckFilters {
  const topic = getFirstString(searchParams.topic);
  const difficultyValue = getFirstString(searchParams.difficulty);
  const dueValue = getFirstString(searchParams.due);

  return {
    topic: topic || undefined,
    difficulty: isDifficulty(difficultyValue) ? difficultyValue : undefined,
    due: isDueState(dueValue) ? dueValue : undefined,
  };
}

function getFirstString(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isDifficulty(value?: string): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isDueState(value?: string): value is Flashcard["dueState"] {
  return value === "due" || value === "overdue" || value === "new" || value === "upcoming" || value === "mastered";
}
