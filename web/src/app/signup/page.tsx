import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoogleAuthEntry } from "@/components/auth/google-auth-entry";
import { AuthShell } from "@/components/layout";
import { getAuthEntryRedirectPath } from "@/lib/auth/auth-page-redirect";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đăng ký",
};

export default async function SignupPage() {
  const authenticatedRedirect = getAuthEntryRedirectPath(await hasAuthenticatedSession());
  if (authenticatedRedirect) redirect(authenticatedRedirect);

  return (
    <AuthShell
      title="Tạo tài khoản và bắt đầu học ngay"
      description="Bắt đầu với tài liệu mẫu hoặc tài liệu của bạn. Bạn đăng ký bằng tài khoản Google và chỉ mất vài bước thiết lập."
    >
      <GoogleAuthEntry />
    </AuthShell>
  );
}
