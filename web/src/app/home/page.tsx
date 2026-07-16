import type { Metadata } from "next";
import { LearnerDashboard } from "@/components/dashboard/learner-dashboard";
import { LearnerShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Learner dashboard",
  description:
    "Theo dõi review queue, tài liệu sẵn sàng, job xử lý, điểm yếu và tiến độ học tập hôm nay.",
};

export default function HomeDashboardPage() {
  return (
    <LearnerShell
      title="Hôm nay bạn nên học gì?"
      subtitle="Ưu tiên review queue, theo dõi job đang xử lý và quay lại đúng điểm yếu trước khi học tài liệu mới."
    >
      <LearnerDashboard />
    </LearnerShell>
  );
}
