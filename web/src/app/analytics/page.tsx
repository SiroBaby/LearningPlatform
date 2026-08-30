import { LearnerShell } from "@/components/layout";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export default function AnalyticsPage() {
  return (
    <LearnerShell
      title="Tiến độ học tập"
      subtitle="Nhìn lại điều bạn đã vững và chọn đúng phần cần ôn tiếp theo."
    >
      <AnalyticsDashboard />
    </LearnerShell>
  );
}
