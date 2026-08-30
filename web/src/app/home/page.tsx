import type { Metadata } from "next";
import { LearnerDashboard } from "@/components/dashboard/learner-dashboard";
import { LearnerShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Trang chủ",
  description:
    "Chọn một việc học phù hợp nhất cho hôm nay và tiếp tục tiến bộ từ tài liệu của bạn.",
};

export default function HomeDashboardPage() {
  return (
    <LearnerShell
      title="Hôm nay bạn nên học gì?"
      subtitle="Một bước nhỏ hôm nay sẽ giúp bạn nhớ lâu hơn vào ngày mai."
    >
      <LearnerDashboard />
    </LearnerShell>
  );
}
