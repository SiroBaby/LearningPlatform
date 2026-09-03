import { LearnerShell } from "@/components/layout/learner-shell";
import { SkeletonList } from "@/components/ui/skeleton";

interface LearnerRouteLoadingProps {
  readonly title: string;
  readonly description: string;
}

export function LearnerRouteLoading({ title, description }: LearnerRouteLoadingProps) {
  return (
    <LearnerShell title={title} subtitle={description}>
      <div aria-busy="true" aria-label="Đang tải nội dung">
        <SkeletonList rows={2} />
      </div>
    </LearnerShell>
  );
}
