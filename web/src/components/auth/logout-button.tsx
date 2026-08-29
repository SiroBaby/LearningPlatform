"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, useToast } from "@/components/ui";
import { routes } from "@/lib/routes";

interface LogoutButtonProps {
  readonly className?: string;
  readonly variant?: "danger" | "ghost" | "outline" | "primary" | "secondary";
}

export function LogoutButton({ className, variant = "outline" }: LogoutButtonProps) {
  const router = useRouter();
  const { notify } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function logout(): Promise<void> {
    setIsSubmitting(true);
    try {
      const response = await fetch("/auth/logout", {
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      if (!response.ok) throw new Error("logout failed");

      router.replace(routes.login);
      router.refresh();
    } catch {
      notify("Không thể đăng xuất. Vui lòng thử lại.", "error");
      setIsSubmitting(false);
    }
  }

  return (
    <Button
      aria-label="Đăng xuất khỏi tài khoản"
      className={className}
      disabled={isSubmitting}
      onClick={() => void logout()}
      type="button"
      variant={variant}
    >
      <LogOut aria-hidden className="h-4 w-4" />
      {isSubmitting ? "Đang đăng xuất..." : "Đăng xuất"}
    </Button>
  );
}
