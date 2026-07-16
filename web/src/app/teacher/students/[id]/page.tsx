import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { TeacherShell } from "@/components/layout";
import {
  TeacherAttemptHistory,
  TeacherTopicInsightsPanel,
  TeacherTrendPanel,
  TeacherWarningCallout,
} from "@/components/teacher/teacher-widgets";
import {
  getClassTopicInsights,
  getStudentSnapshot,
} from "@/components/teacher/teacher-data";
import { getStudent } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Student Progress",
  description:
    "Student progress detail cho teacher: attempt history, weak topics, review activity và missing assignments.",
};

export default async function TeacherStudentProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = getStudent(id);

  if (!result) {
    notFound();
  }

  const { student, classroom } = result;
  const snapshot = getStudentSnapshot(student.id);
  const topicInsights = getClassTopicInsights(classroom).filter((insight) =>
    student.weakTopics.includes(insight.name),
  );

  return (
    <TeacherShell
      title={student.name}
      subtitle={`Student progress trong ${classroom.name}. Dùng view này để xem attempt history, weak topics và activity gần đây của từng học sinh.`}
    >
      <div className="space-y-6">
        {student.missingAssignments > 0 ? (
          <TeacherWarningCallout>
            {student.name} đang thiếu {student.missingAssignments} assignment. Nên follow-up cá nhân trước khi giao thêm bài mới để tránh backlog tiếp tục tăng.
          </TeacherWarningCallout>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-ink-100">
            <CardBody>
              <p className="text-sm font-medium text-ink-500">Avg score</p>
              <p className="mt-2 text-3xl font-semibold text-ink-900">{student.avgScorePct}%</p>
              <p className="mt-2 text-sm text-ink-600">Độ chính xác trung bình trên quiz và checkpoint gần nhất.</p>
            </CardBody>
          </Card>
          <Card className="border-ink-100">
            <CardBody>
              <p className="text-sm font-medium text-ink-500">Review streak</p>
              <p className="mt-2 text-3xl font-semibold text-ink-900">{student.reviewStreak}</p>
              <p className="mt-2 text-sm text-ink-600">Số ngày review liên tiếp tính tới lần hoạt động cuối cùng.</p>
            </CardBody>
          </Card>
          <Card className="border-ink-100">
            <CardBody>
              <p className="text-sm font-medium text-ink-500">Due reviews</p>
              <p className="mt-2 text-3xl font-semibold text-ink-900">{snapshot.dueReviews}</p>
              <p className="mt-2 text-sm text-ink-600">Task review đang chờ hoàn thành trong tuần này.</p>
            </CardBody>
          </Card>
          <Card className="border-ink-100">
            <CardBody>
              <p className="text-sm font-medium text-ink-500">Missing assignments</p>
              <p className="mt-2 text-3xl font-semibold text-ink-900">{student.missingAssignments}</p>
              <p className="mt-2 text-sm text-ink-600">Assignment chưa nộp, nên ưu tiên xử lý trước task mới.</p>
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <TeacherTrendPanel
            title="Accuracy trend"
            description={`Review minutes tuần này: ${snapshot.reviewMinutesThisWeek} phút · hoạt động cuối ${snapshot.lastActiveAt}.`}
            items={snapshot.weeklyAccuracy}
            summary={`${student.name} dao động quanh ${student.avgScorePct}% accuracy trong tuần này; điểm yếu hiện tập trung ở ${student.weakTopics.join(", ")}.`}
          />
          <TeacherTrendPanel
            title="Review activity mix"
            description="Tỷ trọng effort giữa flashcards, quiz retry và tutor usage của học sinh."
            items={snapshot.reviewLoad}
            summary={`Khối lượng review hiện nghiêng về ${snapshot.reviewLoad[0]?.label?.toLowerCase() ?? "review queue"}; cần cân bằng lại nếu một loại hoạt động đang bị bỏ quên.`}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Attempt history</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Lịch sử bài làm và note ngắn theo từng lần để teacher có thể review cùng học sinh.
              </p>
            </CardHeader>
            <CardBody>
              <TeacherAttemptHistory attempts={snapshot.attemptHistory} />
            </CardBody>
          </Card>

          <TeacherTopicInsightsPanel
            insights={topicInsights}
            title="Weak topics"
            description="Các chủ đề yếu của riêng học sinh này, có thể dùng để lên review plan hoặc mini intervention cá nhân."
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Teacher notes</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Ghi chú mock-only để mô phỏng insight giáo viên muốn lưu theo từng học sinh.
              </p>
            </CardHeader>
            <CardBody>
              <ul className="space-y-3 text-sm leading-6 text-ink-700">
                {snapshot.notes.map((note) => (
                  <li key={note} className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
                    {note}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card className="border-ink-100">
            <CardHeader>
              <CardTitle>Suggested interventions</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Hướng can thiệp ngắn gọn để chuyển từ quan sát sang hành động ngay trong giờ dạy hoặc follow-up sau lớp.
              </p>
            </CardHeader>
            <CardBody>
              <ul className="space-y-3 text-sm leading-6 text-ink-700">
                {snapshot.interventions.map((intervention) => (
                  <li
                    key={intervention}
                    className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"
                  >
                    {intervention}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </TeacherShell>
  );
}
