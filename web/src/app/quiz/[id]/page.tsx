import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { QuizStartScreen } from "@/components/quiz/quiz-start-screen";
import { getPhase0QuizServer, Phase0ServerError } from "@/lib/phase0/server-data";

interface QuizStartPageProps {
  params: Promise<{ id: string }>;
}

async function loadQuizOr404(id: string) {
  try {
    return await getPhase0QuizServer(id);
  } catch (error) {
    if (error instanceof Phase0ServerError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

export function generateMetadata(): Metadata {
  return {
    title: "Bắt đầu quiz",
    description: "Chọn cách làm bài và bắt đầu quiz.",
  };
}

export default async function QuizStartPage({ params }: QuizStartPageProps) {
  const { id } = await params;
  const quiz = await loadQuizOr404(id);

  return (
    <LearnerShell
      title="Bắt đầu quiz"
      subtitle="Chọn cách làm bài, xem số câu hỏi và tiếp tục nếu bạn đang làm dở."
    >
      <QuizStartScreen quiz={quiz} />
    </LearnerShell>
  );
}
