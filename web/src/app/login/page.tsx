import { redirect } from "next/navigation";

import { AuthShell } from "@/components/layout";
import { GoogleAuthEntry } from "@/components/auth/google-auth-entry";
import { getAuthEntryRedirectPath } from "@/lib/auth/auth-page-redirect";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const authenticatedRedirect = getAuthEntryRedirectPath(await hasAuthenticatedSession());
  if (authenticatedRedirect) redirect(authenticatedRedirect);

  const params = await searchParams;
  return (
    <AuthShell
      title="Đăng nhập để tiếp tục vòng học đang dở"
      description="Tiếp tục review queue, quiz đang làm dở và tutor theo đúng tài liệu của bạn. Mọi lời giải vẫn giữ citation nguồn để bạn kiểm chứng khi cần."
    >
      <GoogleAuthEntry hasError={Boolean(params.error)} />
    </AuthShell>
  );
}
