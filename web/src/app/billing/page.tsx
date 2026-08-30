import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { BillingOverview } from "@/components/billing/billing-overview";

export const metadata: Metadata = {
  title: "Gói và mức sử dụng",
  description:
    "Xem gói hiện tại, lượt dùng, giới hạn tải lên và lịch sử tạo nội dung học tập.",
};

export default function BillingPage() {
  return (
    <LearnerShell
      title="Gói và mức sử dụng"
      subtitle="Xem gói hiện tại, lượt dùng và giới hạn tải lên để chủ động tiếp tục học."
    >
      <BillingOverview />
    </LearnerShell>
  );
}
