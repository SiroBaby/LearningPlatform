import type { Metadata } from "next";
import { LifeBuoy, Search, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/layout";
import { Badge } from "@/components/ui";
import { AdminMockActionButton } from "@/components/admin/admin-mock-action-button";
import { supportCases } from "@/components/admin/admin-data";

export const metadata: Metadata = {
  title: "Admin Support",
  description:
    "Support view cho operator: user lookup, document/job history, billing status và audit log.",
};

export default function AdminSupportPage() {
  return (
    <AdminShell
      title="Support"
      subtitle="Tra cứu user, document/job history và billing status trong một màn hình an toàn, ưu tiên auditability hơn tốc độ thao tác mù quáng."
    >
      <div className="space-y-6">
        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <div className="mb-4 flex items-start gap-3">
            <Search className="mt-0.5 h-5 w-5 text-brand-200" aria-hidden />
            <div>
              <h2 className="text-lg font-semibold text-white">User lookup</h2>
              <p className="mt-1 text-sm text-ink-300">
                Đây là mock support surface: hiển thị các case điển hình với billing status, latest job và audit trail để main agent verify luồng thao tác operator.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-brand-400/20 bg-brand-500/10 px-4 py-4 text-sm text-brand-100">
            Tìm kiếm chưa nối backend. Thay vào đó, bảng dưới mô phỏng 3 case phổ biến: processing chậm, refund mismatch và yêu cầu support impersonation an toàn.
          </div>
        </section>

        <div className="space-y-4">
          {supportCases.map((supportCase) => (
            <section
              key={supportCase.id}
              className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={supportCase.priority === "high" ? "error" : supportCase.priority === "medium" ? "warning" : "neutral"}>
                      {supportCase.priority}
                    </Badge>
                    <Badge tone="brand">{supportCase.billingStatus}</Badge>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-white">
                    {supportCase.userName}
                  </h2>
                  <p className="mt-1 text-sm text-ink-300">{supportCase.userEmail}</p>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-white/85">
                    {supportCase.issue}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:w-[360px] xl:grid-cols-1">
                  <div className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4 text-sm text-ink-300">
                    <p className="font-semibold text-white">Latest document</p>
                    <p className="mt-2 leading-6">{supportCase.latestDocument}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4 text-sm text-ink-300">
                    <p className="font-semibold text-white">Latest job</p>
                    <p className="mt-2 font-mono text-xs">{supportCase.latestJobId ?? "No active job"}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4">
                  <div className="mb-3 flex items-center gap-2 text-white">
                    <LifeBuoy className="h-4 w-4" aria-hidden />
                    <p className="text-sm font-semibold">Audit trail</p>
                  </div>
                  <ul className="space-y-3 text-sm leading-6 text-ink-300">
                    {supportCase.auditTrail.map((event) => (
                      <li
                        key={event}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-3"
                      >
                        {event}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-4 rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4">
                  <div className="flex items-start gap-2 text-white">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-success-200" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold">Safe support actions</p>
                      <p className="mt-2 text-sm leading-6 text-ink-300">
                        Chỉ hiển thị actions có thể audit lại; destructive action hoặc impersonation thật chưa được bật trong mock surface này.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <AdminMockActionButton
                      label={supportCase.supportLinkLabel}
                      message={`Đã mock action: ${supportCase.supportLinkLabel} cho ${supportCase.userName}.`}
                    />
                    <AdminMockActionButton
                      label="Copy audit summary"
                      message={`Đã mock copy audit summary cho case ${supportCase.id}.`}
                      variant="secondary"
                    />
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
