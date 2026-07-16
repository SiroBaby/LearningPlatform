import { assignments, classrooms, documents, weakTopics } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type {
  Assignment,
  ClassStudent,
  Classroom,
  LearningDocument,
  WeakTopic,
} from "@/lib/types";

interface TrendPoint {
  label: string;
  value: number;
  tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
}

export interface TeacherActivity {
  id: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  summary: string;
  timestamp: string;
  tone: "brand" | "success" | "warning" | "error";
  href: string;
}

export interface TeacherTopicInsight {
  name: string;
  impactedStudents: number;
  masteryPct: number;
  missedQuestions: number;
  evidence?: WeakTopic;
  recommendedAction: string;
}

export interface TeacherIntervention {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  href: string;
}

export interface StudentAttemptSummary {
  id: string;
  title: string;
  submittedAt: string;
  scorePct: number;
  mode: "practice" | "test";
  topicFocus: string;
  note: string;
}

export interface StudentProgressSnapshot {
  studentId: string;
  lastActiveAt: string;
  reviewMinutesThisWeek: number;
  dueReviews: number;
  completedAssignments: number;
  weeklyAccuracy: readonly TrendPoint[];
  reviewLoad: readonly TrendPoint[];
  attemptHistory: readonly StudentAttemptSummary[];
  notes: readonly string[];
  interventions: readonly string[];
}

const MIN_MASTERY = 28;
const MAX_MASTERY = 96;
const LOW_SCORE_THRESHOLD = 60;
function clampPct(value: number): number {
  return Math.min(MAX_MASTERY, Math.max(MIN_MASTERY, Math.round(value)));
}

function buildTopicAction(topicName: string): string {
  if (topicName === "Đồng bộ tiến trình") {
    return "Cho học sinh làm lại 3 câu sai có trích dẫn nguồn trước khi giao quiz mới.";
  }
  if (topicName === "UDP vs TCP") {
    return "Giao lại checkpoint video và yêu cầu so sánh TCP/UDP bằng ví dụ thực tế.";
  }
  if (topicName === "Định thời CPU") {
    return "Chia nhóm mini-lesson 15 phút về Round-Robin và trạng thái tiến trình.";
  }
  if (topicName === "Deadlock") {
    return "Ôn lại 4 điều kiện Coffman rồi cho bài tập nhận diện deadlock ngắn.";
  }
  return "Tạo một bài review ngắn và theo dõi lại sau 48 giờ.";
}

function findWeakTopic(topicName: string): WeakTopic | undefined {
  return weakTopics.find((topic) => topic.name === topicName);
}

export function getClassAssignments(classId: string): Assignment[] {
  return assignments.filter((assignment) => assignment.classId === classId);
}

export function getClassDocuments(classroom: Classroom): LearningDocument[] {
  return classroom.documentIds
    .map((documentId) => documents.find((document) => document.id === documentId))
    .filter((document): document is LearningDocument => Boolean(document));
}

export function getClassRiskStudents(classroom: Classroom): ClassStudent[] {
  return classroom.students.filter(
    (student) =>
      student.avgScorePct < LOW_SCORE_THRESHOLD ||
      student.missingAssignments > 0 ||
      student.reviewStreak === 0,
  );
}

export function getTopicMasteryForStudent(
  student: ClassStudent,
  topicName: string,
): number {
  const weaknessPenalty = student.weakTopics.includes(topicName) ? 16 : 0;
  const assignmentPenalty = student.missingAssignments * 7;
  const streakBonus = Math.min(10, student.reviewStreak * 2);
  return clampPct(student.avgScorePct - weaknessPenalty - assignmentPenalty + streakBonus);
}

export function getClassTopicInsights(classroom: Classroom): TeacherTopicInsight[] {
  const counts = new Map<string, number>();
  for (const student of classroom.students) {
    for (const topicName of student.weakTopics) {
      counts.set(topicName, (counts.get(topicName) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, impactedStudents]) => {
      const evidence = findWeakTopic(name);
      const sampledStudent = classroom.students.find((student) =>
        student.weakTopics.includes(name),
      );
      const derivedMastery = sampledStudent
        ? getTopicMasteryForStudent(sampledStudent, name)
        : 52;
      return {
        name,
        impactedStudents,
        masteryPct: evidence?.masteryPct ?? derivedMastery,
        missedQuestions: evidence?.missedQuestions ?? impactedStudents + 1,
        evidence,
        recommendedAction: buildTopicAction(name),
      } satisfies TeacherTopicInsight;
    })
    .sort((left, right) => {
      if (right.impactedStudents !== left.impactedStudents) {
        return right.impactedStudents - left.impactedStudents;
      }
      return left.masteryPct - right.masteryPct;
    });
}

export function getTeacherWideTopicInsights(): TeacherTopicInsight[] {
  const aggregate = new Map<
    string,
    {
      impactedStudents: number;
      masteryTotal: number;
      masteryCount: number;
      missedQuestions: number;
      evidence?: WeakTopic;
    }
  >();

  for (const classroom of classrooms) {
    for (const insight of getClassTopicInsights(classroom)) {
      const current = aggregate.get(insight.name);
      if (!current) {
        aggregate.set(insight.name, {
          impactedStudents: insight.impactedStudents,
          masteryTotal: insight.masteryPct,
          masteryCount: 1,
          missedQuestions: insight.missedQuestions,
          evidence: insight.evidence,
        });
        continue;
      }

      current.impactedStudents += insight.impactedStudents;
      current.masteryTotal += insight.masteryPct;
      current.masteryCount += 1;
      current.missedQuestions += insight.missedQuestions;
      current.evidence ??= insight.evidence;
    }
  }

  return Array.from(aggregate.entries())
    .map(([name, value]) => ({
      name,
      impactedStudents: value.impactedStudents,
      masteryPct: Math.round(value.masteryTotal / value.masteryCount),
      missedQuestions: value.missedQuestions,
      evidence: value.evidence,
      recommendedAction: buildTopicAction(name),
    }))
    .sort((left, right) => {
      if (right.impactedStudents !== left.impactedStudents) {
        return right.impactedStudents - left.impactedStudents;
      }
      return left.masteryPct - right.masteryPct;
    });
}

export function getTeacherMetrics(): {
  classCount: number;
  totalStudents: number;
  averageMasteryPct: number;
  followUpStudents: number;
} {
  const totalStudents = classrooms.reduce(
    (count, classroom) => count + classroom.studentCount,
    0,
  );
  const followUpStudents = classrooms.reduce(
    (count, classroom) => count + getClassRiskStudents(classroom).length,
    0,
  );
  const averageMasteryPct = Math.round(
    classrooms.reduce((sum, classroom) => sum + classroom.avgMasteryPct, 0) /
      classrooms.length,
  );
  return {
    classCount: classrooms.length,
    totalStudents,
    averageMasteryPct,
    followUpStudents,
  };
}

export const teacherWeeklyMasteryTrend: readonly TrendPoint[] = [
  { label: "Tuần 1", value: 49, tone: "warning" },
  { label: "Tuần 2", value: 52, tone: "warning" },
  { label: "Tuần 3", value: 56, tone: "brand" },
  { label: "Tuần 4", value: 57, tone: "success" },
] as const;

export const teacherRecentActivities: readonly TeacherActivity[] = [
  {
    id: "activity_1",
    studentId: "st_2",
    studentName: "Trần Thị Bình",
    classId: "class_os_2026",
    className: "Hệ điều hành — Lớp K68 CNTT",
    summary: "Nộp quiz Chương 3 với 64% và bỏ trống 1 câu về Deadlock.",
    timestamp: "2026-07-08T08:45:00Z",
    tone: "warning",
    href: routes.teacherStudent("st_2"),
  },
  {
    id: "activity_2",
    studentId: "st_1",
    studentName: "Nguyễn Văn An",
    classId: "class_os_2026",
    className: "Hệ điều hành — Lớp K68 CNTT",
    summary: "Hoàn thành review queue 5 ngày liên tiếp và tăng độ chính xác lên 78%.",
    timestamp: "2026-07-08T07:20:00Z",
    tone: "success",
    href: routes.teacherStudent("st_1"),
  },
  {
    id: "activity_3",
    studentId: "st_3",
    studentName: "Lê Hoàng Cường",
    classId: "class_os_2026",
    className: "Hệ điều hành — Lớp K68 CNTT",
    summary: "Bỏ lỡ 2 assignment liên tiếp và chưa quay lại checkpoint UDP vs TCP.",
    timestamp: "2026-07-07T19:10:00Z",
    tone: "error",
    href: routes.teacherStudent("st_3"),
  },
] as const;

const studentSnapshots: Record<string, StudentProgressSnapshot> = {
  st_1: {
    studentId: "st_1",
    lastActiveAt: "2026-07-08T07:15:00Z",
    reviewMinutesThisWeek: 92,
    dueReviews: 2,
    completedAssignments: 2,
    weeklyAccuracy: [
      { label: "T2", value: 72, tone: "brand" },
      { label: "T3", value: 75, tone: "brand" },
      { label: "T4", value: 78, tone: "success" },
      { label: "T5", value: 79, tone: "success" },
      { label: "T6", value: 81, tone: "success" },
    ],
    reviewLoad: [
      { label: "Flashcards", value: 68, tone: "review" },
      { label: "Quiz retry", value: 82, tone: "brand" },
      { label: "Tutor", value: 44, tone: "mastery" },
    ],
    attemptHistory: [
      {
        id: "st1_att_1",
        title: "Quiz Chương 3 — Quản lý tiến trình",
        submittedAt: "2026-07-08T07:05:00Z",
        scorePct: 78,
        mode: "practice",
        topicFocus: "Đồng bộ tiến trình",
        note: "Sửa được lỗi ở wait()/signal() nhưng vẫn cần ôn semaphore.",
      },
      {
        id: "st1_att_2",
        title: "Checkpoint video — Giao thức TCP",
        submittedAt: "2026-07-06T20:10:00Z",
        scorePct: 84,
        mode: "practice",
        topicFocus: "TCP",
        note: "Nắm chắc three-way handshake, phản hồi tốt với giải thích trích dẫn.",
      },
    ],
    notes: [
      "Duy trì review streak tốt, phản hồi nhanh sau khi nhận feedback.",
      "Nên giao thêm câu hỏi vận dụng để tránh học thuộc máy móc.",
    ],
    interventions: [
      "Cho bạn An làm mentor nhóm 2 người ở phần Đồng bộ tiến trình.",
      "Tăng độ khó bằng 1 assignment test mode vào cuối tuần.",
    ],
  },
  st_2: {
    studentId: "st_2",
    lastActiveAt: "2026-07-08T08:45:00Z",
    reviewMinutesThisWeek: 54,
    dueReviews: 4,
    completedAssignments: 1,
    weeklyAccuracy: [
      { label: "T2", value: 66, tone: "warning" },
      { label: "T3", value: 61, tone: "warning" },
      { label: "T4", value: 64, tone: "warning" },
      { label: "T5", value: 62, tone: "warning" },
      { label: "T6", value: 64, tone: "brand" },
    ],
    reviewLoad: [
      { label: "Flashcards", value: 41, tone: "review" },
      { label: "Quiz retry", value: 64, tone: "brand" },
      { label: "Tutor", value: 27, tone: "mastery" },
    ],
    attemptHistory: [
      {
        id: "st2_att_1",
        title: "Quiz Chương 3 — Quản lý tiến trình",
        submittedAt: "2026-07-08T08:45:00Z",
        scorePct: 64,
        mode: "practice",
        topicFocus: "Deadlock",
        note: "Bỏ sót điều kiện Coffman và nhầm trạng thái Ready/Waiting.",
      },
      {
        id: "st2_att_2",
        title: "Ôn lại câu sai — Round-Robin",
        submittedAt: "2026-07-05T21:30:00Z",
        scorePct: 58,
        mode: "practice",
        topicFocus: "Định thời CPU",
        note: "Cần ví dụ trực quan hơn để phân biệt quantum và priority.",
      },
    ],
    notes: [
      "Có tiến triển khi học lại bằng câu hỏi ngắn, nhưng dễ mất tập trung nếu task quá dài.",
      "Cần nhắc nộp assignment sớm hơn 24h để tránh dồn việc.",
    ],
    interventions: [
      "Giao review plan 10 phút/ngày cho 2 chủ đề: CPU scheduling và Deadlock.",
      "Bật attempt tối đa 2 lần và yêu cầu đọc lại citation trước lần làm lại.",
    ],
  },
  st_3: {
    studentId: "st_3",
    lastActiveAt: "2026-07-06T18:20:00Z",
    reviewMinutesThisWeek: 21,
    dueReviews: 7,
    completedAssignments: 0,
    weeklyAccuracy: [
      { label: "T2", value: 52, tone: "error" },
      { label: "T3", value: 48, tone: "error" },
      { label: "T4", value: 51, tone: "warning" },
      { label: "T5", value: 46, tone: "error" },
      { label: "T6", value: 49, tone: "error" },
    ],
    reviewLoad: [
      { label: "Flashcards", value: 24, tone: "review" },
      { label: "Quiz retry", value: 49, tone: "brand" },
      { label: "Tutor", value: 18, tone: "mastery" },
    ],
    attemptHistory: [
      {
        id: "st3_att_1",
        title: "Quiz Chương 3 — Quản lý tiến trình",
        submittedAt: "2026-07-06T18:20:00Z",
        scorePct: 49,
        mode: "test",
        topicFocus: "Đồng bộ tiến trình",
        note: "Sai 2 câu liên tiếp về semaphore và deadlock, chưa xem lại nguồn.",
      },
      {
        id: "st3_att_2",
        title: "Checkpoint video — UDP vs TCP",
        submittedAt: "2026-07-04T20:15:00Z",
        scorePct: 44,
        mode: "practice",
        topicFocus: "UDP vs TCP",
        note: "Bỏ lỡ checkpoint video, cần can thiệp sớm để tránh rơi khỏi nhịp lớp.",
      },
    ],
    notes: [
      "Tín hiệu disengage rõ: streak = 0, 2 assignment thiếu, tần suất đăng nhập thấp.",
      "Cần follow-up cá nhân thay vì chỉ gửi nhắc nhở chung.",
    ],
    interventions: [
      "Đặt cuộc hẹn 1:1 15 phút để gỡ phần UDP vs TCP bằng transcript video.",
      "Chia assignment thành checkpoint nhỏ và yêu cầu nộp lại trong 48 giờ.",
    ],
  },
};

export function getStudentSnapshot(studentId: string): StudentProgressSnapshot {
  return studentSnapshots[studentId] ?? {
    studentId,
    lastActiveAt: "2026-07-05T09:00:00Z",
    reviewMinutesThisWeek: 0,
    dueReviews: 0,
    completedAssignments: 0,
    weeklyAccuracy: [],
    reviewLoad: [],
    attemptHistory: [],
    notes: [],
    interventions: [],
  };
}

export function getTeacherInterventions(classroom: Classroom): TeacherIntervention[] {
  const topicInsights = getClassTopicInsights(classroom);
  const riskStudents = getClassRiskStudents(classroom);
  const highestRiskStudent = riskStudents[0];
  return [
    {
      id: "intervention_1",
      title: `Can thiệp nhóm cho ${topicInsights[0]?.name ?? "chủ đề yếu"}`,
      description:
        topicInsights[0]?.recommendedAction ??
        "Tạo review queue ngắn và yêu cầu đọc lại citation trước khi làm lại.",
      priority: "high",
      href: routes.teacherClass(classroom.id),
    },
    {
      id: "intervention_2",
      title: "Ưu tiên học sinh có assignment thiếu",
      description: `${riskStudents.length} học sinh cần follow-up trong 24h, nổi bật là ${highestRiskStudent?.name ?? "nhóm nguy cơ cao"}.`,
      priority: riskStudents.length >= 2 ? "high" : "medium",
      href: highestRiskStudent
        ? routes.teacherStudent(highestRiskStudent.id)
        : routes.teacherClasses,
    },
    {
      id: "intervention_3",
      title: "Bật lại vật liệu đang xử lý/fail cho lớp",
      description:
        "Theo dõi tài liệu chưa sẵn sàng để tránh assignment mới bị chậm hơn tiến độ lớp.",
      priority: "low",
      href: routes.teacherClasses,
    },
  ];
}

export const allClassrooms = classrooms;
