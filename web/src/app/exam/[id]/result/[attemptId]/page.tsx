import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { ExamResultScreen } from "@/components/exam/exam-result-screen";
import { attempts, exams, quizzes } from "@/lib/mock-data";

interface ExamResultPageProps {
  params: Promise<{ id: string; attemptId: string }>;
}

export function generateStaticParams() {
  return exams.flatMap((exam) =>
    attempts.map((attempt) => ({ id: exam.id, attemptId: attempt.id })),
  );
}

export async function generateMetadata({ params }: ExamResultPageProps): Promise<Metadata> {
  const { id } = await params;
  const exam = exams.find((item) => item.id === id);

  return {
    title: exam ? `${exam.name} · Result` : "Exam result",
    description:
      "Result screen với score, topic breakdown, explanation và citation để biết nên retry phần nào trước kỳ thi.",
  };
}

export default async function ExamResultPage({ params }: ExamResultPageProps) {
  const { id, attemptId } = await params;
  const exam = exams.find((item) => item.id === id);
  const attempt = attempts.find((item) => item.id === attemptId);

  if (!exam || !attempt) {
    notFound();
  }

  const questionPool = quizzes.flatMap((quiz) => quiz.questions);
  const questions = questionPool.filter((question) =>
    attempt.answers.some((answer) => answer.questionId === question.id),
  );

  return (
    <LearnerShell
      title={`${exam.name} · Result`}
      subtitle="Topic breakdown, mistake review và citation source giúp bạn biết chính xác nên quay lại đoạn nào trước khi thi thật."
    >
      <ExamResultScreen exam={exam} attempt={attempt} questions={questions} />
    </LearnerShell>
  );
}
