import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { BillingOverview } from "@/components/billing/billing-overview";

export const metadata: Metadata = {
  title: "Billing & usage",
  description:
    "Xem plan hiện tại, credits, giới hạn upload, lịch sử xử lý và các limit state có thể chặn phiên học tiếp theo.",
};

export default function BillingPage() {
  return (
    <LearnerShell
      title="Billing & usage"
      subtitle="Xem plan hiện tại, credits, giới hạn upload, lịch sử xử lý và các giới hạn có thể chặn phiên học tiếp theo."
    >
      <BillingOverview />
    </LearnerShell>
  );
}
