"use client";

import { LearnerRouteError } from "@/components/shared/learner-route-error";
import { routes } from "@/lib/routes";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LearnerRouteError
      title="Quiz chưa thể mở"
      description="Quiz có thể đang được chuẩn bị hoặc gặp lỗi tạm thời. Hãy thử lại sau ít phút."
      backHref={routes.library}
      backLabel="Về thư viện"
      reset={reset}
    />
  );
}
