import { redirect } from "next/navigation";

import { getAdminAccess } from "@/lib/admin/operations";
import { getAdminAccessRedirectPath } from "@/lib/admin/redirect";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactNode> {
  const access = await getAdminAccess();
  const redirectPath = getAdminAccessRedirectPath(access.kind);
  if (redirectPath) redirect(redirectPath);
  return children;
}
