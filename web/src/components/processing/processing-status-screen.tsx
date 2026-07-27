"use client";

import { routes } from "@/lib/routes";
import { ProcessingDocumentInfoPanel, ProcessingHeader, ProcessingStatusPanel } from "./processing-status-sections";
import { useProcessingDocumentStatus } from "./processing-status-utils";

interface ProcessingStatusScreenProps {
  readonly documentId: string;
}

export function ProcessingStatusScreen({ documentId }: ProcessingStatusScreenProps) {
  const { document, isLoading, error } = useProcessingDocumentStatus(documentId);
  const detailHref = routes.document(documentId);
  const libraryHref = routes.library;

  return (
    <div className="space-y-6">
      <ProcessingHeader
        document={document}
        detailHref={detailHref}
        libraryHref={libraryHref}
        error={error}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ProcessingStatusPanel document={document} isLoading={isLoading} />
        <ProcessingDocumentInfoPanel document={document} detailHref={detailHref} />
      </div>
    </div>
  );
}
