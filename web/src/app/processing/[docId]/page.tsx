import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { ProcessingStatusScreen } from "@/components/processing/processing-status-screen";

interface ProcessingPageProps {
  params: Promise<{ docId: string }>;
}

export const metadata: Metadata = {
  title: "Trạng thái tài liệu",
  description:
    "Theo dõi trạng thái xử lý tài liệu và xem khi nào quiz sẵn sàng.",
};

export default async function ProcessingPage({ params }: ProcessingPageProps) {
  const { docId } = await params;

  return (
    <LearnerShell
      title="Trạng thái tài liệu"
      subtitle="Theo dõi tiến độ xử lý, xem lỗi nếu có và mở lại tài liệu khi đã sẵn sàng."
    >
      <ProcessingStatusScreen documentId={docId} />
    </LearnerShell>
  );
}
