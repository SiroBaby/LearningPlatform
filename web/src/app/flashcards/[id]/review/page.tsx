import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { FlashcardReviewExperience } from "@/components/flashcards/flashcard-review-experience";
import { LinkButton } from "@/components/ui";
import { getDeck } from "@/lib/mock-data";
import { routes } from "@/lib/routes";

export async function generateMetadata(props: PageProps<"/flashcards/[id]/review">): Promise<Metadata> {
  const { id } = await props.params;
  const deck = getDeck(id);

  if (!deck) {
    return {
      title: "Flashcard review not found",
    };
  }

  return {
    title: `${deck.title} review`,
    description: `Phiên review spaced repetition cho deck ${deck.title}.`,
  };
}

export default async function FlashcardReviewPage(props: PageProps<"/flashcards/[id]/review">) {
  const { id } = await props.params;
  const deck = getDeck(id);

  if (!deck) {
    notFound();
  }

  const reviewCards = deck.cards.filter((card) => card.dueState !== "mastered");

  return (
    <LearnerShell
      title="Flashcard review"
      subtitle="Reveal answer, xem citation, rồi chấm Again / Hard / Good / Easy bằng chuột hoặc bàn phím."
      actions={
        <>
          <LinkButton href={routes.deck(deck.id)} variant="outline">
            Back to deck
          </LinkButton>
          <LinkButton href={routes.review} variant="outline">
            Review queue
          </LinkButton>
        </>
      }
    >
      <FlashcardReviewExperience deck={deck} reviewCards={reviewCards} />
    </LearnerShell>
  );
}
