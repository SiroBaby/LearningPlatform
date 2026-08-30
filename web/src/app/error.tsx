"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";
import { SystemStatePage } from "@/components/shared/system-state";

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
    <SystemStatePage
      badge="System issue"
      title="Có lỗi xảy ra khi dựng màn hình này"
      description="Đây là lỗi không mong đợi ở giao diện. Bạn có thể thử tải lại trang hoặc quay về trang chủ để tiếp tục học."
      detail={error.message ? `Chi tiết kỹ thuật: ${error.message}` : undefined}
      icon="error"
      tone="error"
      primaryAction={
        <Button type="button" onClick={() => reset()}>
          Thử render lại
        </Button>
      }
      secondaryAction={<LinkButton href="/home" variant="outline">Về trang chủ</LinkButton>}
    />
  );
}
