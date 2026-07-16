import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { ReviewPageContent } from "@/components/review/review-page-content";
import { LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Review queue",
  description: "Ôn lại thẻ đến hạn, thẻ quá hạn, và các task nên làm tiếp theo.",
};

export default function ReviewPage() {
  return (
    <LearnerShell
      title="Review queue"
      subtitle="Due today, overdue, upcoming, và breakdown theo course / document để bạn biết nên học gì trước."
      actions={
        <>
          <LinkButton href={routes.studyPlan} variant="outline">
            Study plan
          </LinkButton>
          <LinkButton href={routes.tutor}>
            Ask Tutor
          </LinkButton>
        </>
      }
    >
      <ReviewPageContent />
    </LearnerShell>
  );
}
