"use client";

import { Button } from "@/components/ui";

export function ReloadButton({
  label = "Thử lại",
}: {
  label?: string;
}) {
  return (
    <Button type="button" variant="outline" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
