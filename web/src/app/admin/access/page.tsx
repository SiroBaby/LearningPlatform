import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { AdminActionsPanel } from "@/components/admin/admin-actions-panel";
import { AdminShell } from "@/components/layout";
import { getAdminActorRole, getAdminOperations, getAdminRoleChangeRequests, getAdminSuperAdminBootstrapStatus } from "@/lib/admin/operations";
import { getAdminRedirectPath } from "@/lib/admin/redirect";

export const metadata: Metadata = {
  title: "Người dùng & quyền",
  description: "Xem và xử lý các thay đổi quyền truy cập.",
};

export default async function AdminAccessPage(): Promise<React.ReactNode> {
  const [result, actorRole, roleChangeRequests, superAdminStatus] = await Promise.all([
    getAdminOperations(),
    getAdminActorRole(),
    getAdminRoleChangeRequests(),
    getAdminSuperAdminBootstrapStatus(),
  ]);
  const redirectPath = getAdminRedirectPath(result.kind);
  if (redirectPath) redirect(redirectPath);

  return (
    <AdminShell title="Người dùng & quyền" subtitle="Kiểm tra người có quyền quản trị và xử lý yêu cầu thay đổi.">
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-review-50/70 p-6 sm:p-8">
          <div className="flex max-w-3xl items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-sm">
              <ShieldCheck className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-brand-700">Quản lý quyền truy cập</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Đúng người, đúng quyền</h2>
              <p className="mt-3 text-base leading-7 text-ink-600">Mỗi yêu cầu đều có lý do rõ ràng và được kiểm tra trước khi áp dụng.</p>
            </div>
          </div>
        </section>
        <AdminActionsPanel actorRole={actorRole} initialRoleChangeRequests={roleChangeRequests?.items ?? []} roleChangeRequestsAvailable={roleChangeRequests !== null} superAdminStatus={superAdminStatus} />
      </div>
    </AdminShell>
  );
}
