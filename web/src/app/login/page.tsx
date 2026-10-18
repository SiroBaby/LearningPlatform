import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/layout";
import { GoogleAuthEntry } from "@/components/auth/google-auth-entry";
import { getAuthEntryRedirectPath } from "@/lib/auth/auth-page-redirect";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const authenticatedRedirect = getAuthEntryRedirectPath(await hasAuthenticatedSession());
  if (authenticatedRedirect) redirect(authenticatedRedirect);

  const params = await searchParams;
  return (
    <AuthShell
      title="Đăng nhập để học tiếp"
      description="Tiếp tục danh sách ôn tập, quiz đang làm dở và trợ giảng theo đúng tài liệu của bạn. Lời giải luôn kèm nguồn để bạn đối chiếu."
    >
      <GoogleAuthEntry hasError={Boolean(params.error)} />
    </AuthShell>
  );
}
