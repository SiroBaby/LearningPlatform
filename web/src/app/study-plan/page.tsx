import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { ReviewPageContent } from "@/components/review/review-page-content";

export const metadata: Metadata = {
  title: "Kế hoạch học",
  description: "Xem những việc nên làm tiếp theo để duy trì nhịp ôn tập.",
};

export default function StudyPlanPage() {
  return (
    <LearnerShell
      title="Kế hoạch học"
      subtitle="Bắt đầu từ những việc có tác động lớn nhất cho buổi học hôm nay."
    >
      <ReviewPageContent />
    </LearnerShell>
  );
}
