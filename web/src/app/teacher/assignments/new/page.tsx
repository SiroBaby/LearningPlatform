import type { Metadata } from "next";
import { TeacherShell } from "@/components/layout";
import { TeacherAssignmentForm } from "@/components/teacher/teacher-assignment-form";

export const metadata: Metadata = {
  title: "New Assignment",
  description:
    "Assignment creation cho teacher: chọn class, document, output, due date và attempt rules.",
};

export default function TeacherAssignmentNewPage() {
  return (
    <TeacherShell
      title="Create Assignment"
      subtitle="Chọn output đã generate sẵn, đặt due date và attempt rule rồi preview trước khi publish cho cả lớp."
    >
      <TeacherAssignmentForm />
    </TeacherShell>
  );
}
