import type { Metadata } from "next";
import { AdminShell } from "@/components/layout";
import { AdminJobsBoard } from "@/components/admin/admin-jobs-board";
import {
  AdminAlertList,
  AdminCostPanel,
  AdminJobsOverview,
} from "@/components/admin/admin-widgets";
import {
  allJobs,
  jobStatusShare,
  operationalAlerts,
  processingReliabilityTrend,
} from "@/components/admin/admin-data";

export const metadata: Metadata = {
  title: "Admin Jobs",
  description:
    "Job monitoring view cho operator: filter trạng thái, pipeline step, correlation ID, error reason và retry action mock.",
};

export default function AdminJobsPage() {
  return (
    <AdminShell
      title="Jobs"
      subtitle="Theo dõi pipeline document processing theo từng job để debug fail, backlog và retry waste mà không cần rời admin workspace."
    >
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
          <AdminCostPanel
            title="Reliability trend"
            description="Tỷ lệ job thành công trong các ngày gần đây."
            data={processingReliabilityTrend}
            summary="Reliability giữ quanh 94–97%; ngày có extract fail tăng sẽ tụt rõ, nên view này giúp operator phát hiện sớm drift của pipeline."
            mode="trend"
          />
          <AdminCostPanel
            title="Status distribution"
            description="Ảnh chụp nhanh trạng thái queue hiện tại."
            data={jobStatusShare}
            summary="Phần running, completed và failed đang gần cân bằng; failure rate vẫn đủ cao để cần ưu tiên root cause thay vì chỉ retry hàng loạt."
            mode="bar"
          />
        </div>

        <AdminAlertList alerts={operationalAlerts} />

        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Job list</h2>
            <p className="mt-1 text-sm text-ink-300">
              Filter nằm cùng hàng phía trên bảng để operator có thể đổi trạng thái, refresh mental model và retry case fail nhanh hơn.
            </p>
          </div>
          <AdminJobsBoard jobs={allJobs} />
        </section>

        <AdminJobsOverview jobs={allJobs} />
      </div>
    </AdminShell>
  );
}
