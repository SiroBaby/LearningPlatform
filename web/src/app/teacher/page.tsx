import type { Metadata } from "next";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { TeacherShell } from "@/components/layout";
import {
  TeacherActivityFeed,
  TeacherAssignmentsPanel,
  TeacherClassList,
  TeacherDueDateCard,
  TeacherInterventionsPanel,
  TeacherMetricGrid,
  TeacherTopicInsightsPanel,
  TeacherTrendPanel,
  TeacherWarningCallout,
} from "@/components/teacher/teacher-widgets";
import {
  allClassrooms,
  getClassAssignments,
  getClassDocuments,
  getClassTopicInsights,
  getTeacherInterventions,
  getTeacherMetrics,
  teacherRecentActivities,
  teacherWeeklyMasteryTrend,
} from "@/components/teacher/teacher-data";

export const metadata: Metadata = {
  title: "Teacher Home",
  description:
    "Teacher dashboard với classes overview, assignments, weak topics và suggested interventions.",
};

function buildTeacherMetricCards() {
  const metrics = getTeacherMetrics();
  return [
    {
      label: "Classes đang quản lý",
      value: String(metrics.classCount),
      detail: `${metrics.totalStudents} học sinh đang học trong workspace này.`,
      tone: "brand" as const,
    },
    {
      label: "Mastery trung bình",
      value: `${metrics.averageMasteryPct}%`,
      detail: "Tính trên các lớp đã có document và attempt activity.",
      tone: "success" as const,
    },
    {
      label: "Cần follow-up",
      value: String(metrics.followUpStudents),
      detail: "Học sinh có missing assignment, score thấp hoặc review streak = 0.",
      tone: "warning" as const,
    },
    {
      label: "Materials sẵn sàng",
      value: `${allClassrooms.reduce(
        (count, classroom) =>
          count +
          getClassDocuments(classroom).filter((document) => document.status === "ready").length,
        0,
      )}`,
      detail: "Tổng document ready có thể dùng để giao quiz hoặc checkpoint ngay.",
      tone: "mastery" as const,
    },
  ];
}

export default function TeacherDashboardPage() {
  const primaryClassroom = allClassrooms[0];
  const dashboardAssignments = getClassAssignments(primaryClassroom.id);
  const topicInsights = getClassTopicInsights(primaryClassroom);
  const interventions = getTeacherInterventions(primaryClassroom);
  const processingDocuments = getClassDocuments(primaryClassroom).filter(
    (document) => document.status !== "ready",
  );

  return (
    <TeacherShell
      title="Teacher Home"
      subtitle="Theo dõi lớp, assignment, materials processing và điểm yếu của cả lớp trong một workspace riêng với learner UI."
    >
      <div className="space-y-6">
        <TeacherMetricGrid items={buildTeacherMetricCards()} />

        {processingDocuments.length > 0 ? (
          <TeacherWarningCallout>
            {processingDocuments.length} material trong {primaryClassroom.name} chưa sẵn sàng. Hãy kiểm tra lại pipeline trước khi publish assignment mới để tránh học sinh vào bài nhưng chưa có output.
          </TeacherWarningCallout>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <TeacherTrendPanel
            title="Mastery trend của lớp chính"
            description="Tóm tắt tiến độ học trong 4 tuần gần nhất để bạn nhìn nhanh hướng đi của cả lớp."
            items={teacherWeeklyMasteryTrend}
            summary="Mastery của lớp Hệ điều hành tăng từ 49% lên 57% trong 4 tuần gần nhất, nhưng tốc độ cải thiện đang chậm lại ở tuần cuối."
          />
          <TeacherDueDateCard assignment={dashboardAssignments[0]} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Recent student activity</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Feed ưu tiên tín hiệu cần hành động: score giảm, missing assignment hoặc review streak tốt đáng ghi nhận.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherActivityFeed activities={teacherRecentActivities} />
            </CardBody>
          </Card>

          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Assignments due</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Các assignment đang mở trong lớp chính với tiến độ nộp hiện tại.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherAssignmentsPanel assignments={dashboardAssignments} />
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <TeacherTopicInsightsPanel
            insights={topicInsights}
            title="Weak topics across class"
            description="Charts luôn có tóm tắt bằng chữ và không dựa vào màu đơn thuần. Dùng nó để chọn chủ đề ôn tập chung cho cả lớp."
          />
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Suggested interventions</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Gợi ý follow-up ngắn gọn để giáo viên chuyển từ quan sát sang hành động.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherInterventionsPanel interventions={interventions} />
            </CardBody>
          </Card>
        </div>

        <Card className="border-ink-100">
          <CardHeader>
            <CardTitle>Classes overview</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Mỗi card tách riêng metric lớp, progress và action để teacher workspace không bị lẫn với learner dashboard.
            </p>
          </CardHeader>
          <CardBody>
            <TeacherClassList classrooms={allClassrooms} />
          </CardBody>
        </Card>
      </div>
    </TeacherShell>
  );
}
