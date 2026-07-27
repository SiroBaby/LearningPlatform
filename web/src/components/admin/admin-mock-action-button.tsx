"use client";

import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export function AdminMockActionButton({
  label,
  message,
  variant = "outline",
  className,
}: {
  label: string;
  message: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  className?: string;
}) {
  const { notify } = useToast();

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={() => notify(message, variant === "danger" ? "error" : "info")}
    >
      {label}
    </Button>
  );
}
