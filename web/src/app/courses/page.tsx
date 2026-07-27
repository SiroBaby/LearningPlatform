import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { CoursesPageContent } from "@/components/courses/courses-page-content";
import { courses, documents } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Courses",
  description:
    "Nhóm document theo course để theo dõi mastery, due reviews, study plan và exam prep theo từng hành trình học.",
};

export default function CoursesPage() {
  return (
    <LearnerShell
      title="Courses"
      subtitle="Course chỉ nhóm document để học có chiến lược hơn — quiz và output vẫn bám document gốc."
    >
      <CoursesPageContent courses={courses} documents={documents} />
    </LearnerShell>
  );
}
