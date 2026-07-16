import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  Clock3,
  FileStack,
  GraduationCap,
  Layers3,
  PlayCircle,
  Users,
} from "lucide-react";
import {
  Badge,
  BarChart,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  LinkButton,
  ProgressBar,
  ProgressRing,
  StatusPill,
  StepTimeline,
  TrendChart,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Assignment, Classroom, LearningDocument } from "@/lib/types";
import type {
  StudentAttemptSummary,
  TeacherActivity,
  TeacherIntervention,
  TeacherTopicInsight,
} from "./teacher-data";
import {
  getClassAssignments,
  getClassDocuments,
  getClassRiskStudents,
  getTopicMasteryForStudent,
} from "./teacher-data";

interface TeacherMetricCardData {
  label: string;
  value: string;
  detail: string;
  tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
}

const toneAccentMap: Record<
  NonNullable<TeacherMetricCardData["tone"]>,
  string
> = {
  brand: "bg-brand-50 text-brand-700 border-brand-100",
  success: "bg-success-50 text-success-700 border-success-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  error: "bg-error-50 text-error-700 border-error-100",
  mastery: "bg-mastery-50 text-mastery-600 border-mastery-100",
  review: "bg-review-50 text-review-600 border-review-100",
};

const assignmentToneMap: Record<Assignment["status"], "neutral" | "brand" | "success"> = {
  draft: "neutral",
  published: "brand",
  closed: "success",
};

function getPriorityTone(priority: TeacherIntervention["priority"]):
  | "error"
  | "warning"
  | "neutral" {
  if (priority === "high") return "error";
  if (priority === "medium") return "warning";
  return "neutral";
}

function getActivityToneClass(tone: TeacherActivity["tone"]): string {
  if (tone === "success") return "border-success-100 bg-success-50/70";
  if (tone === "warning") return "border-warning-100 bg-warning-50/70";
  if (tone === "error") return "border-error-100 bg-error-50/70";
  return "border-brand-100 bg-brand-50/70";
}

function getProgressTone(value: number):
  | "success"
  | "brand"
  | "warning"
  | "review" {
  if (value >= 80) return "success";
  if (value >= 65) return "brand";
  if (value >= 50) return "warning";
  return "review";
}

function getOutputLabel(document: LearningDocument): string[] {
  return document.outputs.map((output) => {
    if (output === "checkpoints") return "Checkpoints";
    if (output === "flashcards") return "Flashcards";
    if (output === "tutor") return "Tutor";
    return "Quiz";
  });
}

export function TeacherMetricGrid({
  items,
}: {
  items: readonly TeacherMetricCardData[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="border-ink-100">
          <CardBody className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-500">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">
                {item.value}
              </p>
              <p className="mt-2 text-sm text-ink-600">{item.detail}</p>
            </div>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold",
                toneAccentMap[item.tone ?? "brand"],
              )}
            >
              Snapshot
            </span>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function TeacherClassList({
  classrooms,
}: {
  classrooms: readonly Classroom[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {classrooms.map((classroom) => {
        const classAssignments = getClassAssignments(classroom.id);
        const classDocuments = getClassDocuments(classroom);
        const riskStudents = getClassRiskStudents(classroom);
        const readyMaterials = classDocuments.filter(
          (document) => document.status === "ready",
        ).length;
        return (
          <Card key={classroom.id} className="border-ink-100">
            <CardBody className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{classroom.subject}</Badge>
                    <Badge tone="neutral">{classroom.studentCount} students</Badge>
                  </div>
                  <CardTitle className="mt-3 text-xl">{classroom.name}</CardTitle>
                  <p className="mt-2 text-sm text-ink-600">
                    {classAssignments.length} assignment, {readyMaterials}/{classDocuments.length} tài
                    liệu sẵn sàng, {riskStudents.length} học sinh cần follow-up.
                  </p>
                </div>
                <ProgressRing
                  value={classroom.avgMasteryPct}
                  size={72}
                  tone={getProgressTone(classroom.avgMasteryPct)}
                  label={`Mastery trung bình lớp ${classroom.name}`}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
                    Assignment đang mở
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-ink-900">
                    {classAssignments.filter((assignment) => assignment.status === "published").length}
                  </p>
                </div>
                <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
                    Missing work
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-ink-900">
                    {classroom.students.reduce(
                      (sum, student) => sum + student.missingAssignments,
                      0,
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
                    Review streak tốt
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-ink-900">
                    {
                      classroom.students.filter((student) => student.reviewStreak >= 3)
                        .length
                    }
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <LinkButton href={routes.teacherClass(classroom.id)} variant="primary">
                  Mở class detail
                </LinkButton>
                <LinkButton href={routes.teacherAssignmentNew} variant="outline">
                  Tạo assignment mới
                </LinkButton>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

export function TeacherActivityFeed({
  activities,
}: {
  activities: readonly TeacherActivity[];
}) {
  if (activities.length === 0) {
    return (
      <EmptyState
        icon={Clock3}
        title="Chưa có activity mới"
        description="Khi học sinh làm quiz, review hoặc bỏ lỡ assignment, feed này sẽ hiện ở đây."
      />
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <Link
          key={activity.id}
          href={activity.href}
          className={cn(
            "block rounded-2xl border px-4 py-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40",
            getActivityToneClass(activity.tone),
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink-900">{activity.studentName}</p>
              <p className="mt-1 text-sm leading-6 text-ink-700">{activity.summary}</p>
              <p className="mt-2 text-xs text-ink-500">
                {activity.className} · {formatDateTime(activity.timestamp)}
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          </div>
        </Link>
      ))}
    </div>
  );
}

export function TeacherAssignmentsPanel({
  assignments,
}: {
  assignments: readonly Assignment[];
}) {
  if (assignments.length === 0) {
    return (
      <EmptyState
        icon={FileStack}
        title="Chưa có assignment"
        description="Tạo assignment đầu tiên để đẩy quiz hoặc checkpoint ra lớp và theo dõi tiến độ nộp bài."
        action={
          <LinkButton href={routes.teacherAssignmentNew} variant="primary">
            Tạo assignment
          </LinkButton>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {assignments.map((assignment) => {
        const submissionPct = Math.round(
          (assignment.submittedCount / assignment.totalCount) * 100,
        );
        return (
          <div
            key={assignment.id}
            className="rounded-2xl border border-ink-100 bg-white px-4 py-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={assignmentToneMap[assignment.status]}>
                    {assignment.status === "draft"
                      ? "Draft"
                      : assignment.status === "published"
                        ? "Published"
                        : "Closed"}
                  </Badge>
                  <span className="text-xs text-ink-500">
                    Due {formatDate(assignment.dueDate)}
                  </span>
                </div>
                <p className="mt-2 text-base font-semibold text-ink-900">
                  {assignment.title}
                </p>
                <p className="mt-1 text-sm text-ink-600">{assignment.documentTitle}</p>
              </div>
              <Link
                href={routes.teacherClasses}
                className="text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                Xem lớp
              </Link>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-500">Tiến độ nộp</span>
                <span className="font-medium text-ink-800">
                  {assignment.submittedCount}/{assignment.totalCount}
                </span>
              </div>
              <ProgressBar value={submissionPct} tone={getProgressTone(submissionPct)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TeacherTopicInsightsPanel({
  insights,
  title,
  description,
}: {
  insights: readonly TeacherTopicInsight[];
  title: string;
  description: string;
}) {
  if (insights.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Chưa có dữ liệu weak topics"
        description="Khi lớp bắt đầu có attempt và review activity, bạn sẽ thấy chủ đề yếu và đề xuất can thiệp tại đây."
      />
    );
  }

  const chartData = insights.map((insight) => ({
    label: insight.name,
    value: insight.masteryPct,
    tone: getProgressTone(insight.masteryPct),
  }));
  const summary = insights
    .map(
      (insight) =>
        `${insight.name}: ${insight.masteryPct}% mastery, ${insight.impactedStudents} học sinh bị ảnh hưởng.`,
    )
    .join(" ");

  return (
    <Card className="border-ink-100">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-sm text-ink-600">{description}</p>
      </CardHeader>
      <CardBody className="space-y-6">
        <BarChart data={chartData} summary={summary} />
        <div className="space-y-3">
          {insights.map((insight) => (
            <div
              key={insight.name}
              className="rounded-2xl border border-ink-100 bg-ink-50/70 px-4 py-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-ink-900">{insight.name}</p>
                    <Badge tone={getProgressTone(insight.masteryPct)}>
                      {insight.masteryPct}% mastery
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    {insight.impactedStudents} học sinh đang yếu, {insight.missedQuestions} câu
                    sai gần đây.
                  </p>
                </div>
                <p className="max-w-sm text-sm text-ink-600">
                  {insight.recommendedAction}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export function TeacherInterventionsPanel({
  interventions,
}: {
  interventions: readonly TeacherIntervention[];
}) {
  if (interventions.length === 0) {
    return (
      <EmptyState
        icon={Layers3}
        title="Chưa có intervention gợi ý"
        description="Khi có dữ liệu yếu rõ ràng hơn, hệ thống sẽ đề xuất can thiệp ở mức lớp hoặc từng học sinh."
      />
    );
  }

  return (
    <div className="space-y-3">
      {interventions.map((intervention) => (
        <div
          key={intervention.id}
          className="rounded-2xl border border-ink-100 bg-white px-4 py-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-ink-900">
                  {intervention.title}
                </p>
                <Badge tone={getPriorityTone(intervention.priority)}>
                  {intervention.priority}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                {intervention.description}
              </p>
            </div>
            <Link
              href={intervention.href}
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              Mở chi tiết
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TeacherMaterialsPanel({
  classroom,
}: {
  classroom: Classroom;
}) {
  const classDocuments = getClassDocuments(classroom);
  if (classDocuments.length === 0) {
    return (
      <EmptyState
        icon={FileStack}
        title="Lớp chưa có tài liệu"
        description="Thêm document vào lớp để tạo quiz, flashcards hoặc checkpoint cho học sinh."
      />
    );
  }

  return (
    <div className="space-y-4">
      {classDocuments.map((document) => (
        <div
          key={document.id}
          className="rounded-2xl border border-ink-100 bg-white px-4 py-4"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={document.status} />
                <Badge tone="neutral">{document.type.toUpperCase()}</Badge>
              </div>
              <p className="mt-2 text-base font-semibold text-ink-900">{document.title}</p>
              <p className="mt-1 text-sm text-ink-600">
                Uploaded {formatDateTime(document.uploadedAt)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {getOutputLabel(document).map((label) => (
                  <Badge key={label} tone="brand">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
            {typeof document.masteryPct === "number" ? (
              <ProgressRing
                value={document.masteryPct}
                size={68}
                tone={getProgressTone(document.masteryPct)}
                label={`Mastery của ${document.title}`}
              />
            ) : null}
          </div>

          {document.processing ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-500">Processing progress</span>
                  <span className="font-medium text-ink-800">
                    {document.processing.percent}%
                  </span>
                </div>
                <ProgressBar
                  value={document.processing.percent}
                  tone={document.status === "failed" ? "error" : "brand"}
                />
                {document.processing.failureReason ? (
                  <div className="mt-3 rounded-xl border border-error-100 bg-error-50 px-3 py-3 text-sm text-error-700">
                    {document.processing.failureReason}
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 px-4 py-4">
                <StepTimeline steps={document.processing.steps} />
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TeacherStudentTable({
  classroom,
}: {
  classroom: Classroom;
}) {
  if (classroom.students.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Chưa có học sinh"
        description="Roster sẽ hiện tại đây khi lớp có người học được gán hoặc tự tham gia."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="border-b border-ink-200 px-4 py-3 text-left font-semibold text-ink-600">
              Student
            </th>
            <th className="border-b border-ink-200 px-4 py-3 text-left font-semibold text-ink-600">
              Avg score
            </th>
            <th className="border-b border-ink-200 px-4 py-3 text-left font-semibold text-ink-600">
              Review streak
            </th>
            <th className="border-b border-ink-200 px-4 py-3 text-left font-semibold text-ink-600">
              Missing
            </th>
            <th className="border-b border-ink-200 px-4 py-3 text-left font-semibold text-ink-600">
              Weak topics
            </th>
          </tr>
        </thead>
        <tbody>
          {classroom.students.map((student) => (
            <tr key={student.id} className="align-top">
              <td className="border-b border-ink-100 px-4 py-4">
                <Link
                  href={routes.teacherStudent(student.id)}
                  className="font-semibold text-ink-900 hover:text-brand-700"
                >
                  {student.name}
                </Link>
              </td>
              <td className="border-b border-ink-100 px-4 py-4 text-ink-700">
                {student.avgScorePct}%
              </td>
              <td className="border-b border-ink-100 px-4 py-4 text-ink-700">
                {student.reviewStreak} ngày
              </td>
              <td className="border-b border-ink-100 px-4 py-4">
                <Badge tone={student.missingAssignments > 0 ? "warning" : "success"}>
                  {student.missingAssignments}
                </Badge>
              </td>
              <td className="border-b border-ink-100 px-4 py-4">
                <div className="flex flex-wrap gap-2">
                  {student.weakTopics.map((topic) => (
                    <Badge key={topic} tone="review">
                      {topic}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeacherTopicMasteryHeatmap({
  classroom,
  insights,
}: {
  classroom: Classroom;
  insights: readonly TeacherTopicInsight[];
}) {
  if (insights.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Chưa có topic mastery map"
        description="Khi có đủ bài làm của cả lớp, heatmap chủ đề sẽ giúp bạn nhìn nhanh ai đang hụt ở đâu."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-100">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-ink-50">
          <tr>
            <th className="border-b border-ink-100 px-4 py-3 text-left font-semibold text-ink-600">
              Topic
            </th>
            {classroom.students.map((student) => (
              <th
                key={student.id}
                className="border-b border-ink-100 px-4 py-3 text-left font-semibold text-ink-600"
              >
                {student.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {insights.map((insight) => (
            <tr key={insight.name} className="align-top">
              <td className="border-b border-ink-100 px-4 py-4 font-medium text-ink-800">
                {insight.name}
              </td>
              {classroom.students.map((student) => {
                const masteryPct = getTopicMasteryForStudent(student, insight.name);
                return (
                  <td key={student.id} className="border-b border-ink-100 px-4 py-4">
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm font-medium",
                        masteryPct >= 80 &&
                          "border-success-100 bg-success-50 text-success-700",
                        masteryPct >= 60 &&
                          masteryPct < 80 &&
                          "border-brand-100 bg-brand-50 text-brand-700",
                        masteryPct >= 45 &&
                          masteryPct < 60 &&
                          "border-warning-100 bg-warning-50 text-warning-700",
                        masteryPct < 45 &&
                          "border-error-100 bg-error-50 text-error-700",
                      )}
                    >
                      <div>{masteryPct}%</div>
                      <div className="mt-1 text-xs font-normal">
                        {masteryPct >= 80
                          ? "Strong"
                          : masteryPct >= 60
                            ? "On track"
                            : masteryPct >= 45
                              ? "Watch"
                              : "Needs help"}
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeacherAttemptHistory({
  attempts,
}: {
  attempts: readonly StudentAttemptSummary[];
}) {
  if (attempts.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="Chưa có attempt history"
        description="Khi học sinh bắt đầu làm quiz hoặc checkpoint, lịch sử attempt sẽ hiện để bạn review cùng feedback."
      />
    );
  }

  return (
    <div className="space-y-3">
      {attempts.map((attempt) => (
        <div
          key={attempt.id}
          className="rounded-2xl border border-ink-100 bg-white px-4 py-4"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-ink-900">{attempt.title}</p>
                <Badge tone={getProgressTone(attempt.scorePct)}>
                  {attempt.scorePct}%
                </Badge>
                <Badge tone="neutral">{attempt.mode}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-500">
                {formatDateTime(attempt.submittedAt)} · trọng tâm {attempt.topicFocus}
              </p>
            </div>
            <LinkButton href={routes.teacherClasses} variant="outline" size="sm">
              Xem assignment
            </LinkButton>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink-600">{attempt.note}</p>
        </div>
      ))}
    </div>
  );
}

export function TeacherTrendPanel({
  title,
  description,
  items,
  summary,
}: {
  title: string;
  description: string;
  items: readonly {
    label: string;
    value: number;
    tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
  }[];
  summary: string;
}) {
  return (
    <Card className="border-ink-100">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-sm text-ink-600">{description}</p>
      </CardHeader>
      <CardBody>
        <TrendChart data={items} summary={summary} />
      </CardBody>
    </Card>
  );
}

export function TeacherOverviewSummary({
  classroom,
}: {
  classroom: Classroom;
}) {
  const riskStudents = getClassRiskStudents(classroom);
  const classAssignments = getClassAssignments(classroom.id);
  const classDocuments = getClassDocuments(classroom);

  return (
    <Card className="border-ink-100 bg-brand-50/50">
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-700">Class summary</p>
            <CardTitle className="mt-2 text-xl">{classroom.name}</CardTitle>
          </div>
          <ProgressRing
            value={classroom.avgMasteryPct}
            size={72}
            tone={getProgressTone(classroom.avgMasteryPct)}
            label={`Mastery trung bình của ${classroom.name}`}
          />
        </div>
        <div className="space-y-2 text-sm text-ink-700">
          <p>
            {classroom.studentCount} học sinh, {classAssignments.length} assignment, {" "}
            {classDocuments.length} tài liệu gắn với lớp.
          </p>
          <p>
            {riskStudents.length} học sinh đang cần follow-up, chủ yếu do thiếu assignment hoặc review streak giảm.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <LinkButton href={routes.teacherAssignmentNew} variant="primary">
            Giao assignment mới
          </LinkButton>
          <LinkButton href={routes.teacherClasses} variant="outline">
            Quay lại class list
          </LinkButton>
        </div>
      </CardBody>
    </Card>
  );
}

export function TeacherDueDateCard({
  assignment,
}: {
  assignment?: Assignment;
}) {
  if (!assignment) {
    return (
      <Card className="border-dashed border-ink-200">
        <CardBody>
          <EmptyState
            icon={Calendar}
            title="Không có assignment sắp đến hạn"
            description="Khi bạn publish assignment mới, thẻ này sẽ nhắc deadline gần nhất và tỷ lệ nộp bài."
          />
        </CardBody>
      </Card>
    );
  }

  const submissionPct = Math.round(
    (assignment.submittedCount / assignment.totalCount) * 100,
  );

  return (
    <Card className="border-ink-100">
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-500">Deadline gần nhất</p>
            <p className="mt-1 text-lg font-semibold text-ink-900">{assignment.title}</p>
          </div>
          <Badge tone="brand">{formatDate(assignment.dueDate)}</Badge>
        </div>
        <p className="text-sm text-ink-600">{assignment.documentTitle}</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-500">Nộp bài</span>
            <span className="font-medium text-ink-800">{submissionPct}%</span>
          </div>
          <ProgressBar value={submissionPct} tone={getProgressTone(submissionPct)} />
        </div>
      </CardBody>
    </Card>
  );
}

export function TeacherWarningCallout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-warning-100 bg-warning-50 px-4 py-4 text-sm text-warning-800">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>{children}</div>
      </div>
    </div>
  );
}
