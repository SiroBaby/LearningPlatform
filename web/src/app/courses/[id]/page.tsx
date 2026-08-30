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
    title: course ? course.name : "Không tìm thấy khóa học",
    description:
      "Tổng quan tài liệu, kế hoạch học, câu hỏi, thẻ ghi nhớ, trợ giảng, tiến độ và ôn thi theo từng khóa học.",
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
      subtitle="Tài liệu, lượt ôn đến hạn, trợ giảng và ôn thi được gom lại để bạn chọn bước tiếp theo."
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
