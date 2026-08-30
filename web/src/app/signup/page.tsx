import { redirect } from "next/navigation";

import { GoogleAuthEntry } from "@/components/auth/google-auth-entry";
import { AuthShell } from "@/components/layout";
import { getAuthEntryRedirectPath } from "@/lib/auth/auth-page-redirect";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export default async function SignupPage() {
  const authenticatedRedirect = getAuthEntryRedirectPath(await hasAuthenticatedSession());
  if (authenticatedRedirect) redirect(authenticatedRedirect);

  return (
    <AuthShell
      title="Tạo tài khoản và tới first value thật nhanh"
      description="Bắt đầu với PDF mẫu hoặc tài liệu của riêng bạn. Tài khoản được tạo từ Google Account đã xác minh email, sau đó bạn có thể hoàn tất onboarding ngắn."
    >
      <GoogleAuthEntry />
    </AuthShell>
  );
}
