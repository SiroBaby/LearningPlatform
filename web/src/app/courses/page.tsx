import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { CoursesPageContent } from "@/components/courses/courses-page-content";
import { courses, documents } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Khóa học",
  description:
    "Nhóm tài liệu theo khóa học để theo dõi mức ghi nhớ, lượt ôn đến hạn, kế hoạch học và sự chuẩn bị cho kỳ thi.",
};

export default function CoursesPage() {
  return (
    <LearnerShell
      title="Khóa học"
      subtitle="Gom tài liệu theo mục tiêu để mỗi buổi học có hướng đi rõ ràng hơn."
    >
      <CoursesPageContent courses={courses} documents={documents} />
    </LearnerShell>
  );
}
