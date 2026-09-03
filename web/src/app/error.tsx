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
      badge="Lỗi tạm thời"
      title="Màn hình chưa thể mở"
      description="Đã có lỗi tạm thời khi mở nội dung này. Bạn có thể thử lại hoặc quay về trang chủ để tiếp tục học."
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
