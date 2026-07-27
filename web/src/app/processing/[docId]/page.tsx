import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { ProcessingStatusScreen } from "@/components/processing/processing-status-screen";

interface ProcessingPageProps {
  params: Promise<{ docId: string }>;
}

export const metadata: Metadata = {
  title: "Đang xử lý tài liệu",
  description:
    "Theo dõi tiến trình xử lý tài liệu và xem khi nào quiz sẵn sàng.",
};

export default async function ProcessingPage({ params }: ProcessingPageProps) {
  const { docId } = await params;

  return (
    <LearnerShell
      title="Đang xử lý tài liệu"
      subtitle="Tài liệu của bạn đang được xử lý. Bạn có thể theo dõi tại đây và mở lại khi xong."
    >
      <ProcessingStatusScreen documentId={docId} />
    </LearnerShell>
  );
}
