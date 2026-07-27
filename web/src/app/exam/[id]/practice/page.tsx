import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { PracticeExamScreen } from "@/components/exam/practice-exam-screen";
import { attempts, documents, exams, quizzes } from "@/lib/mock-data";

interface PracticeExamPageProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return exams.map((exam) => ({ id: exam.id }));
}

export async function generateMetadata({ params }: PracticeExamPageProps): Promise<Metadata> {
  const { id } = await params;
  const exam = exams.find((item) => item.id === id);

  return {
    title: exam ? `${exam.name} · Practice` : "Practice exam",
    description:
      "Làm practice exam theo mode có timer, mixed questions và coverage map từ nhiều document đã chọn.",
  };
}

export default async function PracticeExamPage({ params }: PracticeExamPageProps) {
  const { id } = await params;
  const exam = exams.find((item) => item.id === id);

  if (!exam) {
    notFound();
  }

  const coveredDocuments = documents.filter((document) => exam.documentIds.includes(document.id));
  const coveredQuizzes = quizzes.filter((quiz) => exam.documentIds.includes(quiz.documentId));
  const questions = coveredQuizzes.flatMap((quiz) => quiz.questions).slice(0, 10);

  if (questions.length === 0) {
    notFound();
  }

  const coveredDocumentTitles = coveredDocuments.map((document) => document.title);
  const missingCoverageTitles = documents
    .filter((document) => !exam.documentIds.includes(document.id))
    .slice(0, 2)
    .map((document) => document.title);
  const resultAttemptId = attempts[0]?.id ?? "att_os_1";

  return (
    <LearnerShell
      title={`${exam.name} · Practice mode`}
      subtitle="Mixed questions, timed flow, question palette và submit confirmation — đủ để mô phỏng exam sprint mock mà vẫn giữ citation cho bước review sau đó."
    >
      <PracticeExamScreen
        exam={exam}
        questions={questions}
        coveredDocumentTitles={coveredDocumentTitles}
        missingCoverageTitles={missingCoverageTitles}
        resultAttemptId={resultAttemptId}
      />
    </LearnerShell>
  );
}
