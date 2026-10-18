"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";
import { SystemStatePage } from "@/components/shared/system-state";
import { routes } from "@/lib/routes";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <title>Chưa mở được trang · LearningPlatform</title>
      <SystemStatePage
        badge="Lỗi tạm thời"
        title="Chưa mở được trang này"
        description="Hãy thử lại hoặc về trang chủ."
        icon="error"
        tone="error"
        primaryAction={
          <Button type="button" onClick={() => reset()}>
            Thử lại
          </Button>
        }
        secondaryAction={<LinkButton href={routes.landing} variant="outline">Về trang chủ</LinkButton>}
        isAuthenticated={null}
      />
    </>
  );
}
