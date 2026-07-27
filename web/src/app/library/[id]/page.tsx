import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { DocumentDetail } from "@/components/library/document-detail";
import { getPhase0DocumentServer, Phase0ServerError } from "@/lib/phase0/server-data";

interface LibraryDetailPageProps {
  params: Promise<{ id: string }>;
}

async function loadDocument(id: string) {
  try {
    return await getPhase0DocumentServer(id);
  } catch (error) {
    if (error instanceof Phase0ServerError && error.status === 404) {
      notFound();
    }

    throw error;
  }
}

export async function generateMetadata({ params }: LibraryDetailPageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const document = await loadDocument(id);
    return {
      title: document.originalName,
      description:
        "Xem thông tin tài liệu, trạng thái xử lý và quiz liên quan nếu đã sẵn sàng.",
    };
  } catch {
    return {
      title: "Chi tiết tài liệu",
      description: "Xem thông tin chi tiết của tài liệu này.",
    };
  }
}

export default async function LibraryDetailPage({ params }: LibraryDetailPageProps) {
  const { id } = await params;
  const document = await loadDocument(id);

  return (
    <LearnerShell
      title={document.originalName}
      subtitle="Xem thông tin tài liệu, theo dõi trạng thái và mở quiz khi đã có sẵn."
    >
      <DocumentDetail document={document} />
    </LearnerShell>
  );
}
