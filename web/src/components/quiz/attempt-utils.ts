import type { Difficulty, Quiz } from "@/lib/types";

export function getDifficultyLabel(value: Difficulty): string {
  if (value === "easy") {
    return "Dễ";
  }

  if (value === "medium") {
    return "Trung bình";
  }

  return "Khó";
}

export function getAnsweredCount(
  quiz: Quiz,
  answers: Readonly<Record<string, string | null>>,
): number {
  return quiz.questions.filter((question) => answers[question.id]).length;
}
