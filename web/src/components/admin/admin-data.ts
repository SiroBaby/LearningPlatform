import { jobs } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Job } from "@/lib/types";

interface TrendPoint {
  label: string;
  value: number;
  tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
}

export interface AdminMetricCardData {
  label: string;
  value: string;
  detail: string;
  tone: "brand" | "success" | "warning" | "error" | "mastery" | "review";
}

export interface AdminSystemHealthItem {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "warning";
  detail: string;
}

export interface SupportCase {
  id: string;
  userName: string;
  userEmail: string;
  issue: string;
  priority: "high" | "medium" | "low";
  billingStatus: string;
  latestJobId?: string;
  latestDocument: string;
  auditTrail: readonly string[];
  lastUpdatedAt: string;
  supportLinkLabel: string;
}

export interface ModerationItem {
  id: string;
  title: string;
  owner: string;
  reason: string;
  severity: "critical" | "high" | "medium";
  status: "new" | "investigating" | "restricted";
  createdAt: string;
}

export interface OperationalAlert {
  id: string;
  title: string;
  detail: string;
  tone: "brand" | "success" | "warning" | "error";
  href: string;
}

const FAILED_JOB_THRESHOLD = 2;
const RUNNING_JOB_THRESHOLD = 2;

function countJobsByStatus(status: Job["status"]): number {
  return jobs.filter((job) => job.status === status).length;
}

function getFailureRatePct(): number {
  return Math.round((countJobsByStatus("failed") / jobs.length) * 100);
}

export function getAdminOverviewMetrics(): readonly AdminMetricCardData[] {
  const failedJobs = countJobsByStatus("failed");
  return [
    {
      label: "Active users",
      value: "128",
      detail: "92 users quay lại trong 24h qua.",
      tone: "brand",
    },
    {
      label: "Documents processed",
      value: "342",
      detail: "Tăng 18% so với cùng kỳ tuần trước.",
      tone: "success",
    },
    {
      label: "Failed jobs",
      value: String(failedJobs),
      detail:
        failedJobs >= FAILED_JOB_THRESHOLD
          ? "Cần theo dõi pipeline extract/chunk ngay hôm nay."
          : "Trong ngưỡng vận hành bình thường.",
      tone: failedJobs >= FAILED_JOB_THRESHOLD ? "error" : "warning",
    },
    {
      label: "AI cost today",
      value: "$14.82",
      detail: "$412.30 tháng này · cache hit rate 44%.",
      tone: "mastery",
    },
    {
      label: "Credit revenue",
      value: "$287",
      detail: "Gia hạn plan Teacher đóng góp 36% doanh thu ngày.",
      tone: "review",
    },
    {
      label: "Moderation queue",
      value: "5",
      detail: "2 mục cần xử lý trong 2 giờ tới.",
      tone: "warning",
    },
  ] as const;
}

export const processingReliabilityTrend: readonly TrendPoint[] = [
  { label: "T2", value: 96, tone: "success" },
  { label: "T3", value: 94, tone: "success" },
  { label: "T4", value: 91, tone: "warning" },
  { label: "T5", value: 97, tone: "success" },
  { label: "T6", value: 95, tone: "success" },
] as const;

export const jobStatusShare: readonly TrendPoint[] = [
  { label: "Running", value: 33, tone: "brand" },
  { label: "Completed", value: 34, tone: "success" },
  { label: "Failed", value: 33, tone: "error" },
] as const;

export const providerCostShare: readonly TrendPoint[] = [
  { label: "Anthropic", value: 48, tone: "brand" },
  { label: "OpenAI STT", value: 27, tone: "review" },
  { label: "Embeddings", value: 15, tone: "mastery" },
  { label: "Fallback OCR", value: 10, tone: "warning" },
] as const;

export const featureCostShare: readonly TrendPoint[] = [
  { label: "Quiz", value: 37, tone: "brand" },
  { label: "Tutor", value: 28, tone: "mastery" },
  { label: "STT", value: 22, tone: "review" },
  { label: "Embedding", value: 13, tone: "warning" },
] as const;

export const providerMixSnapshot: readonly TrendPoint[] = [
  { label: "Anthropic", value: 46, tone: "brand" },
  { label: "STT vendor", value: 29, tone: "review" },
  { label: "Embedding", value: 16, tone: "mastery" },
  { label: "OCR fallback", value: 9, tone: "warning" },
] as const;

export const costEfficiencyTrend: readonly TrendPoint[] = [
  { label: "Cache hit", value: 44, tone: "success" },
  { label: "Retry waste", value: 12, tone: "warning" },
  { label: "Circuit breaker", value: 100, tone: "brand" },
] as const;

export const topExpensiveDocuments: readonly {
  id: string;
  title: string;
  owner: string;
  estimatedCost: string;
  reason: string;
}[] = [
  {
    id: "exp_doc_1",
    title: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
    owner: "owner_8821",
    estimatedCost: "$3.42",
    reason: "Video dài, có STT + checkpoint extraction.",
  },
  {
    id: "exp_doc_2",
    title: "Machine Learning Foundations — Optimization.pdf",
    owner: "owner_5503",
    estimatedCost: "$2.18",
    reason: "Regenerate quiz 3 lần trong 24h.",
  },
  {
    id: "exp_doc_3",
    title: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
    owner: "owner_8821",
    estimatedCost: "$1.27",
    reason: "Tutor follow-up tăng mạnh sau assignment published.",
  },
] as const;

export const supportCases: readonly SupportCase[] = [
  {
    id: "support_1",
    userName: "Nguyễn Hà My",
    userEmail: "ha.my@student.example.com",
    issue: "Upload video hoàn tất nhưng checkpoint chưa xuất hiện trong lớp.",
    priority: "high",
    billingStatus: "Teacher plan · active",
    latestJobId: "job_1",
    latestDocument: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
    auditTrail: [
      "08:12 · User gửi ticket từ trong app.",
      "08:18 · Operator xác nhận job còn running ở bước chunk.",
      "08:26 · Đã gắn note theo dõi SLA 2 giờ.",
    ],
    lastUpdatedAt: "2026-07-08T08:26:00Z",
    supportLinkLabel: "Support link đã gửi",
  },
  {
    id: "support_2",
    userName: "Lê Minh Khoa",
    userEmail: "khoa@selflearn.example.com",
    issue: "Credits bị trừ dù tài liệu fail ở bước extract.",
    priority: "medium",
    billingStatus: "Student Plus · renewal 2026-08-01",
    latestJobId: "job_2",
    latestDocument: "Ghi chú Giải tích — Tích phân từng phần.txt",
    auditTrail: [
      "07:04 · Refund trigger đã chạy tự động.",
      "07:10 · User vẫn thấy mismatch ở lịch sử billing.",
      "07:14 · Cần đối soát lại ledger và invoice preview.",
    ],
    lastUpdatedAt: "2026-07-08T07:14:00Z",
    supportLinkLabel: "Mở ledger diff",
  },
  {
    id: "support_3",
    userName: "Trần Gia Hân",
    userEmail: "han@teacher.example.com",
    issue: "Cần link impersonation an toàn để xem lại assignment view của học sinh.",
    priority: "low",
    billingStatus: "Teacher plan · active",
    latestDocument: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
    auditTrail: [
      "Hỗ trợ yêu cầu verify role teacher trước khi mở support session.",
      "Chưa có escalation bảo mật.",
    ],
    lastUpdatedAt: "2026-07-07T16:40:00Z",
    supportLinkLabel: "Tạo support session",
  },
] as const;

export const moderationItems: readonly ModerationItem[] = [
  {
    id: "mod_1",
    title: "Upload lặp lại 14 lần trong 30 phút",
    owner: "owner_2214",
    reason: "Pattern spam retry với 1 tệp PDF quá lớn.",
    severity: "high",
    status: "investigating",
    createdAt: "2026-07-08T08:02:00Z",
  },
  {
    id: "mod_2",
    title: "Audio upload không vượt qua malware scan",
    owner: "owner_9982",
    reason: "Verification flag từ storage gateway.",
    severity: "critical",
    status: "new",
    createdAt: "2026-07-08T06:42:00Z",
  },
  {
    id: "mod_3",
    title: "Tutor abuse: prompt injection thử lấy system prompt",
    owner: "owner_7710",
    reason: "Suspicious tutor inputs lặp lại qua 3 documents khác nhau.",
    severity: "medium",
    status: "restricted",
    createdAt: "2026-07-07T22:18:00Z",
  },
] as const;

export const adminSystemHealth: readonly AdminSystemHealthItem[] = [
  {
    id: "health_1",
    name: "Upload gateway",
    status: "healthy",
    detail: "P95 upload verify 1.4s, không có backlog.",
  },
  {
    id: "health_2",
    name: "Quiz generation pipeline",
    status: countJobsByStatus("running") >= RUNNING_JOB_THRESHOLD ? "warning" : "healthy",
    detail: "2 jobs đang chạy ở bước chunk/generate; chưa chạm circuit breaker.",
  },
  {
    id: "health_3",
    name: "Billing ledger sync",
    status: "degraded",
    detail: "Có 1 ticket lệch refund cần đối soát thủ công.",
  },
  {
    id: "health_4",
    name: "Moderation queue SLA",
    status: moderationItems.some((item) => item.severity === "critical")
      ? "warning"
      : "healthy",
    detail: "1 case critical mới vào queue trong 2 giờ gần nhất.",
  },
] as const;

export const operationalAlerts: readonly OperationalAlert[] = [
  {
    id: "alert_1",
    title: "Failure rate đang ở 33%",
    detail: `${getFailureRatePct()}% job hiện fail; kiểm tra lại extract fallback trước giờ cao điểm chiều.`,
    tone: "error",
    href: routes.adminJobs,
  },
  {
    id: "alert_2",
    title: "1 moderation case critical mới vào queue",
    detail: "Cần xác nhận lý do malware flag trước khi user retry upload.",
    tone: "warning",
    href: routes.adminModeration,
  },
  {
    id: "alert_3",
    title: "Teacher support queue có SLA 2 giờ",
    detail: "Ticket checkpoint chưa lên lớp cần được phản hồi trước 10:30.",
    tone: "brand",
    href: routes.adminSupport,
  },
] as const;

export const allJobs = jobs;
