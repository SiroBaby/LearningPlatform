import type { Metadata } from "next";
import { AdminShell } from "@/components/layout";
import { Badge } from "@/components/ui";
import { AdminMockActionButton } from "@/components/admin/admin-mock-action-button";
import { moderationItems } from "@/components/admin/admin-data";
import { AdminModerationRisksPanel } from "@/components/admin/admin-widgets";
import { formatDateTime } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Admin Moderation",
  description:
    "Moderation queue cho operator: flagged files, suspicious usage, malware failures và user restrictions.",
};

function getSeverityTone(severity: "critical" | "high" | "medium"):
  | "error"
  | "warning"
  | "brand" {
  if (severity === "critical") return "error";
  if (severity === "high") return "warning";
  return "brand";
}

export default function AdminModerationPage() {
  return (
    <AdminShell
      title="Moderation"
      subtitle="Queue xử lý flagged files và suspicious usage. UI này cố ý operational-first: rõ severity, auditability và action an toàn."
    >
      <div className="space-y-6">
        <AdminModerationRisksPanel />

        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Moderation queue</h2>
            <p className="mt-1 text-sm text-ink-300">
              Hàng đợi này tách rõ severity, status và lý do để operator có thể phối hợp với support hoặc security mà không mơ hồ.
            </p>
          </div>
          <div className="space-y-4">
            {moderationItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-ink-900/40 px-4 py-4"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={getSeverityTone(item.severity)}>{item.severity}</Badge>
                      <Badge tone="neutral">{item.status}</Badge>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-white">{item.title}</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-300">{item.reason}</p>
                    <p className="mt-3 text-xs text-ink-400">
                      {item.owner} · {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 xl:w-[320px] xl:justify-end">
                    <AdminMockActionButton
                      label="Review mock"
                      message={`Đã mock mở review chi tiết cho case ${item.id}.`}
                    />
                    <AdminMockActionButton
                      label="Restrict mock"
                      message={`Đã mock restrict user ${item.owner}.`}
                      variant="danger"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
