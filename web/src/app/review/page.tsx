import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { ReviewPageContent } from "@/components/review/review-page-content";
import { LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Ôn tập",
  description: "Ôn lại thẻ đến hạn, thẻ quá hạn và những việc nên làm tiếp theo.",
};

export default function ReviewPage() {
  return (
    <LearnerShell
      title="Ôn tập"
      subtitle="Bắt đầu từ những thẻ cần bạn nhớ lại ngay hôm nay."
      actions={
        <>
          <LinkButton href={routes.studyPlan} variant="outline">
            Kế hoạch học
          </LinkButton>
          <LinkButton href={routes.tutor}>
            Hỏi trợ giảng
          </LinkButton>
        </>
      }
    >
      <ReviewPageContent />
    </LearnerShell>
  );
}
