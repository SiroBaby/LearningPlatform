import { LearnerShell } from "@/components/layout";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export default function AnalyticsPage() {
  return (
    <LearnerShell
      title="Learning analytics"
      subtitle="Theo dõi mastery, tiến bộ theo thời gian, điểm yếu và độ sẵn sàng trước kỳ thi — luôn kèm tóm tắt văn bản để không phụ thuộc vào màu của biểu đồ."
    >
      <AnalyticsDashboard />
    </LearnerShell>
  );
}
