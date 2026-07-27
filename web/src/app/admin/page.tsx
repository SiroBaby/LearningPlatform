import type { Metadata } from "next";
import { AdminShell } from "@/components/layout";
import {
  AdminAlertList,
  AdminCostPanel,
  AdminJobsOverview,
  AdminMetricGrid,
  AdminModerationPreview,
  AdminSupportPreview,
  AdminSystemHealthPanel,
  AdminTopDocumentsPanel,
} from "@/components/admin/admin-widgets";
import {
  adminSystemHealth,
  allJobs,
  costEfficiencyTrend,
  featureCostShare,
  getAdminOverviewMetrics,
  jobStatusShare,
  moderationItems,
  operationalAlerts,
  processingReliabilityTrend,
  providerMixSnapshot,
  supportCases,
  topExpensiveDocuments,
} from "@/components/admin/admin-data";

export const metadata: Metadata = {
  title: "Admin Overview",
  description:
    "Operator overview với active users, jobs, AI cost, moderation queue và system health.",
};

export default function AdminOverviewPage() {
  return (
    <AdminShell
      title="Overview"
      subtitle="Operational workspace tách biệt với learner/teacher UI: ưu tiên reliability, cost visibility, moderation và support signals."
    >
      <div className="space-y-6">
        <AdminMetricGrid items={getAdminOverviewMetrics()} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <AdminAlertList alerts={operationalAlerts} />
          <AdminSystemHealthPanel items={adminSystemHealth} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,1fr)]">
          <AdminCostPanel
            title="Processing reliability"
            description="Chart có text summary rõ ràng để operator đọc nhanh cả khi không nhìn màu."
            data={processingReliabilityTrend}
            summary="Pipeline reliability giữ quanh 94–97% trong 5 ngày gần nhất, riêng ngày T4 giảm xuống 91% do extract fail tăng."
            mode="trend"
          />
          <AdminCostPanel
            title="Job status share"
            description="Tỷ lệ running/completed/failed để xem toàn cảnh queue hiện tại."
            data={jobStatusShare}
            summary="Hiện trạng queue đang gần cân bằng giữa running, completed và failed; failure rate vẫn còn quá cao cho giờ cao điểm."
            mode="bar"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <AdminJobsOverview jobs={allJobs} />
          <AdminSupportPreview cases={supportCases} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,1fr)]">
          <AdminModerationPreview items={moderationItems} />
          <AdminTopDocumentsPanel items={topExpensiveDocuments} />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <AdminCostPanel
            title="Cost by feature"
            description="Phân bổ spend giữa quiz, tutor, STT và embedding để quyết định nơi tối ưu trước."
            data={featureCostShare}
            summary="Quiz đang chiếm 37% cost, tutor 28%, STT 22% và embedding 13%; chi phí tăng mạnh khi teacher publish assignment video."
            mode="bar"
          />
          <AdminCostPanel
            title="Efficiency signals"
            description="Cache hit, retry waste và guardrails giúp đọc nhanh hiệu quả sử dụng spend."
            data={costEfficiencyTrend}
            summary="Cache hit rate 44%, retry waste 12% và circuit breaker vẫn đang closed nên chưa cần degrade service."
            mode="bar"
          />
          <AdminCostPanel
            title="Provider mix snapshot"
            description="Tỷ trọng spend theo provider / nhóm model hiện tại."
            data={providerMixSnapshot}
            summary="Provider mix hiện nghiêng về luồng generation chính, nhưng chi phí STT và OCR fallback đang tạo thêm áp lực lên budget ngày."
            mode="bar"
          />
        </div>
      </div>
    </AdminShell>
  );
}
