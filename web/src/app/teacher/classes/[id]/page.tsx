import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { TeacherShell } from "@/components/layout";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import {
  TeacherAssignmentsPanel,
  TeacherMaterialsPanel,
  TeacherOverviewSummary,
  TeacherStudentTable,
  TeacherTopicInsightsPanel,
  TeacherTopicMasteryHeatmap,
} from "@/components/teacher/teacher-widgets";
import {
  allClassrooms,
  getClassAssignments,
  getClassTopicInsights,
} from "@/components/teacher/teacher-data";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Class Detail",
  description:
    "Class detail cho teacher gồm students, materials, assignments và topic mastery heatmap.",
};

export default async function TeacherClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const classroom = allClassrooms.find((item) => item.id === id);

  if (!classroom) {
    notFound();
  }

  const classAssignments = getClassAssignments(classroom.id);
  const topicInsights = getClassTopicInsights(classroom);

  return (
    <TeacherShell
      title={classroom.name}
      subtitle="Class detail gom đủ góc nhìn: materials, assignments, roster và topic mastery để giáo viên không phải nhảy qua nhiều màn hình."
    >
      <div className="space-y-6">
        <TeacherOverviewSummary classroom={classroom} />

        <div className="flex flex-wrap gap-3">
          <Link href={routes.teacherAssignmentNew}>
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              Giao assignment mới
            </Button>
          </Link>
          <Button variant="outline" type="button">
            <Download className="h-4 w-4" aria-hidden />
            Export report mock
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Students</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Roster ưu tiên avg score, review streak, missing assignments và weak topics để giáo viên khoanh vùng nhanh.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherStudentTable classroom={classroom} />
            </CardBody>
          </Card>

          <TeacherTopicInsightsPanel
            insights={topicInsights}
            title="Quiz performance focus"
            description="Các chủ đề yếu được xếp theo số học sinh bị ảnh hưởng rồi đến mastery thấp nhất."
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Assignments</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Theo dõi trạng thái published/draft và tỷ lệ nộp bài hiện tại của từng assignment.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherAssignmentsPanel assignments={classAssignments} />
            </CardBody>
          </Card>

          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Materials</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Materials processing hiển thị bằng timeline rõ ràng thay vì spinner mơ hồ.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherMaterialsPanel classroom={classroom} />
            </CardBody>
          </Card>
        </div>

        <Card className="border-ink-100">
          <CardHeader>
            <CardTitle>Topic mastery heatmap</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Màu chỉ hỗ trợ, còn text trong từng ô luôn nói rõ mức độ strong / on track / watch / needs help.
            </p>
          </CardHeader>
          <CardBody>
            <TeacherTopicMasteryHeatmap classroom={classroom} insights={topicInsights} />
          </CardBody>
        </Card>
      </div>
    </TeacherShell>
  );
}
