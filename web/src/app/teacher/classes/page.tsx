import type { Metadata } from "next";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { TeacherShell } from "@/components/layout";
import {
  TeacherClassList,
  TeacherTopicInsightsPanel,
  TeacherWarningCallout,
} from "@/components/teacher/teacher-widgets";
import {
  allClassrooms,
  getClassDocuments,
  getClassTopicInsights,
  getClassRiskStudents,
} from "@/components/teacher/teacher-data";

export const metadata: Metadata = {
  title: "Teacher Classes",
  description:
    "Class list cho teacher gồm mastery, materials readiness và học sinh cần follow-up.",
};

export default function TeacherClassesPage() {
  const aggregateInsights = allClassrooms.flatMap((classroom) =>
    getClassTopicInsights(classroom),
  );
  const readyDocuments = allClassrooms.reduce(
    (count, classroom) =>
      count +
      getClassDocuments(classroom).filter((document) => document.status === "ready").length,
    0,
  );
  const totalDocuments = allClassrooms.reduce(
    (count, classroom) => count + getClassDocuments(classroom).length,
    0,
  );
  const followUpCount = allClassrooms.reduce(
    (count, classroom) => count + getClassRiskStudents(classroom).length,
    0,
  );

  return (
    <TeacherShell
      title="Classes"
      subtitle="Tập trung vào roster, materials readiness và học sinh cần follow-up trước khi bạn đi sâu vào từng lớp."
    >
      <div className="space-y-6">
        <TeacherWarningCallout>
          {followUpCount} học sinh đang cần follow-up trong toàn bộ teacher workspace. Ưu tiên các lớp có document chưa ready hoặc missing assignments tăng nhanh.
        </TeacherWarningCallout>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Class roster snapshot</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                {readyDocuments}/{totalDocuments} materials đã sẵn sàng cho các lớp. Dùng class cards để mở chi tiết từng lớp hoặc tạo assignment mới.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherClassList classrooms={allClassrooms} />
            </CardBody>
          </Card>

          <TeacherTopicInsightsPanel
            insights={aggregateInsights}
            title="Cross-class weak topics"
            description="Tổng hợp chủ đề yếu nổi bật trên các lớp hiện có để teacher biết nên chuẩn bị mini-lesson hay review material nào trước."
          />
        </div>
      </div>
    </TeacherShell>
  );
}
