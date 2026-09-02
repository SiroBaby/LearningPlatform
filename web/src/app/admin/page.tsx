import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminOperationsDashboard } from "@/components/admin/admin-operations-dashboard";
import { AdminShell } from "@/components/layout";
import { getAdminActorRole, getAdminOperations, getAdminRoleChangeRequests, getAdminSuperAdminBootstrapStatus } from "@/lib/admin/operations";
import { getAdminRedirectPath } from "@/lib/admin/redirect";

export const metadata: Metadata = {
  title: "Tổng quan quản trị",
  description: "Nắm nhanh tình hình chung và những việc cần xử lý.",
};

export default async function AdminOverviewPage(): Promise<React.ReactNode> {
  const [result, actorRole, roleChangeRequests, superAdminStatus] = await Promise.all([
    getAdminOperations(),
    getAdminActorRole(),
    getAdminRoleChangeRequests(),
    getAdminSuperAdminBootstrapStatus(),
  ]);
  const redirectPath = getAdminRedirectPath(result.kind);
  if (redirectPath) redirect(redirectPath);
  return (
    <AdminShell
      title="Tổng quan quản trị"
      subtitle="Nắm nhanh tình hình chung và những việc cần xử lý trong ngày."
    >
      {result.kind === "snapshot" ? (
        <AdminOperationsDashboard snapshot={result.snapshot} actorRole={actorRole} roleChangeRequests={roleChangeRequests?.items ?? []} roleChangeRequestsAvailable={roleChangeRequests !== null} superAdminStatus={superAdminStatus} />
      ) : (
        <section className="rounded-[2rem] border border-error-100 bg-error-50 p-6">
          <h2 className="text-lg font-semibold text-error-700">
            Chưa thể tải thông tin vận hành
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-error-700">
            Hãy tải lại trang sau ít phút. Nếu tình trạng kéo dài, liên hệ người phụ
            trách hệ thống.
          </p>
        </section>
      )}
    </AdminShell>
  );
}
