import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { QuizPlayScreen } from "@/components/quiz/quiz-play-screen";
import { getPhase0QuizServer, Phase0ServerError } from "@/lib/phase0/server-data";
import type { QuizMode } from "@/lib/types";

interface QuizPlayPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[] | undefined; resume?: string | string[] | undefined }>;
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

function readMode(rawMode: string | string[] | undefined): QuizMode {
  const mode = Array.isArray(rawMode) ? rawMode[0] : rawMode;
  return mode === "test" ? "test" : "practice";
}

function readResumeFlag(rawResume: string | string[] | undefined): boolean {
  const resume = Array.isArray(rawResume) ? rawResume[0] : rawResume;
  return resume === "1";
}

export function generateMetadata(): Metadata {
  return {
    title: "Làm quiz",
    description: "Làm quiz, lưu tạm câu trả lời và nộp bài khi sẵn sàng.",
  };
}

export default async function QuizPlayPage({ params, searchParams }: QuizPlayPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const quiz = await loadQuizOr404(id);
  const mode = readMode(query.mode);
  const resume = readResumeFlag(query.resume);

  return (
    <LearnerShell
      title={mode === "test" ? "Quiz · Chế độ kiểm tra" : "Quiz · Chế độ luyện tập"}
      subtitle="Trả lời từng câu, đánh dấu câu cần xem lại và nộp bài khi đã sẵn sàng."
    >
      <QuizPlayScreen quiz={quiz} mode={mode} resume={resume} />
    </LearnerShell>
  );
}
