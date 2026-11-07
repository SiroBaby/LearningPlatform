"use client";

import { LearnerRouteError } from "@/components/shared/learner-route-error";
import { routes } from "@/lib/routes";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LearnerRouteError
      title="Trạng thái tài liệu chưa thể mở"
      description="Chưa thể tải tiến độ. Thử lại hoặc về thư viện."
      backHref={routes.library}
      backLabel="Về thư viện"
      reset={reset}
    />
  );
}
