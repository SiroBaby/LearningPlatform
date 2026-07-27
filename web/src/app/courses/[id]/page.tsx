import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { CourseDetailPageContent } from "@/components/courses/course-detail-page-content";
import {
  attempts,
  courses,
  decks,
  documents,
  exams,
  quizzes,
  studyTasks,
  weakTopics,
} from "@/lib/mock-data";

interface CourseDetailPageProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return courses.map((course) => ({ id: course.id }));
}

export async function generateMetadata({ params }: CourseDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const course = courses.find((item) => item.id === id);

  return {
    title: course ? course.name : "Course not found",
    description:
      "Overview, documents, study plan, quizzes, flashcards, tutor context, analytics và exam prep theo từng course.",
  };
}

export default async function CourseDetailPage({ params }: CourseDetailPageProps) {
  const { id } = await params;
  const course = courses.find((item) => item.id === id);

  if (!course) {
    notFound();
  }

  const courseDocuments = documents.filter((document) => course.documentIds.includes(document.id));
  const courseQuizzes = quizzes.filter((quiz) => course.documentIds.includes(quiz.documentId));
  const quizIds = new Set(courseQuizzes.map((quiz) => quiz.id));
  const courseAttempts = attempts.filter((attempt) => quizIds.has(attempt.quizId));
  const courseDecks = decks.filter((deck) => course.documentIds.includes(deck.documentId));
  const courseStudyTasks = studyTasks.filter((task) =>
    !task.documentTitle || courseDocuments.some((document) => document.title === task.documentTitle),
  );
  const courseWeakTopics = weakTopics.filter((topic) =>
    topic.citations.some((citation) => course.documentIds.includes(citation.documentId)),
  );
  const courseExam = exams.find((exam) => exam.courseId === course.id);

  return (
    <LearnerShell
      title={course.name}
      subtitle="Tất cả signal học tập của course này — documents, due reviews, tutor context và exam prep — được gom lại để bạn quyết định bước tiếp theo nhanh hơn."
    >
      <CourseDetailPageContent
        course={course}
        documents={courseDocuments}
        quizzes={courseQuizzes}
        attempts={courseAttempts}
        decks={courseDecks}
        studyTasks={courseStudyTasks}
        weakTopics={courseWeakTopics}
        exam={courseExam}
      />
    </LearnerShell>
  );
}
