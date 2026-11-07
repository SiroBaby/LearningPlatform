import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { BillingOverview } from "@/components/billing/billing-overview";

export const metadata: Metadata = {
  title: "Gói và mức sử dụng",
  description:
    "Xem gói hiện tại, credit, giới hạn tải lên và lịch sử tạo nội dung.",
};

export default function BillingPage() {
  return (
    <LearnerShell
      title="Gói và mức sử dụng"
      subtitle="Xem gói hiện tại, credit và giới hạn tải lên."
    >
      <BillingOverview />
    </LearnerShell>
  );
}
