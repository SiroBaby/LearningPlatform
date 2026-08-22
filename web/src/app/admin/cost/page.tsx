import type { Metadata } from "next";
import { AdminShell } from "@/components/layout";
import {
  AdminCircuitBreakerPanel,
  AdminCostPanel,
  AdminTopDocumentsPanel,
} from "@/components/admin/admin-widgets";
import {
  costEfficiencyTrend,
  featureCostShare,
  providerCostShare,
  topExpensiveDocuments,
} from "@/components/admin/admin-data";

export const metadata: Metadata = {
  title: "Admin AI Cost",
  description:
    "AI cost dashboard cho operator: provider/model mix, feature spend, cache hit rate và top expensive users/documents.",
};

export default function AdminCostPage() {
  return (
    <AdminShell
      title="AI Cost"
      subtitle="Dashboard tập trung vào spend visibility thay vì generic business chart: cost by provider, feature, retry waste và guardrails."
    >
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <AdminCostPanel
            title="Cost by provider"
            description="Phân bổ spend theo provider / nhóm model để operator biết traffic đang đổ vào đâu."
            data={providerCostShare}
            summary="Anthropic hiện chiếm 48% spend, OpenAI STT 27%, embeddings 15% và OCR fallback 10%; video-heavy workloads kéo cost STT tăng rõ."
            mode="bar"
          />
          <AdminCostPanel
            title="Cost by feature"
            description="So sánh spend giữa quiz, tutor, speech-to-text và embedding."
            data={featureCostShare}
            summary="Quiz vẫn là luồng tốn chi phí nhất, nhưng tutor và STT đang tăng nhanh khi lớp dùng nhiều tài liệu video."
            mode="bar"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,1fr)]">
          <AdminCostPanel
            title="Efficiency + cache"
            description="Một chart nhỏ đủ để đọc cache hit, retry waste và mức guard đang tiêu thụ."
            data={costEfficiencyTrend}
            summary="Cache hit rate 44% còn khá thấp; retry waste 12% cho thấy lỗi job đang đốt thêm chi phí không tạo ra giá trị học tập mới."
            mode="bar"
          />
          <AdminTopDocumentsPanel items={topExpensiveDocuments} />
        </div>

        <AdminCircuitBreakerPanel />
      </div>
    </AdminShell>
  );
}
