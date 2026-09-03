"use client";

import { LearnerRouteError } from "@/components/shared/learner-route-error";
import { routes } from "@/lib/routes";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LearnerRouteError
      title="Thư viện chưa thể mở"
      description="Chưa thể tải tài liệu lúc này. Hãy thử lại hoặc quay về trang chủ."
      backHref={routes.home}
      backLabel="Về trang chủ"
      reset={reset}
    />
  );
}
