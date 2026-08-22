"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { confirmPhase0Document } from "@/lib/phase0/client";
import { routes } from "@/lib/routes";
import { ProcessingDocumentInfoPanel, ProcessingHeader, ProcessingStatusPanel } from "./processing-status-sections";
import { shouldRestoreRetryFocus } from "./processing-focus";
import { createDocumentProcessingRetryAction } from "./processing-retry";
import { useProcessingDocumentStatus } from "./processing-status-utils";

interface ProcessingStatusScreenProps {
  readonly documentId: string;
}

export function ProcessingStatusScreen({ documentId }: ProcessingStatusScreenProps) {
  const { document, isLoading, error, refresh } = useProcessingDocumentStatus(documentId);
  const detailHref = routes.document(documentId);
  const libraryHref = routes.library;
  const [isRetrySubmitting, setIsRetrySubmitting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousRetryErrorRef = useRef<string | null>(null);
  const handleRetryConfirm = useMemo(() => createDocumentProcessingRetryAction({
    documentId,
    refresh,
    setRetryError,
    setIsRetrySubmitting,
    confirmDocument: confirmPhase0Document,
  }), [documentId, refresh]);

  useEffect(() => {
    if (shouldRestoreRetryFocus({
      previousRetryError: previousRetryErrorRef.current,
      retryError,
      isRetrySubmitting,
    })) {
      retryButtonRef.current?.focus();
    }

    previousRetryErrorRef.current = retryError;
  }, [isRetrySubmitting, retryError]);

  return (
    <div className="space-y-6">
      <ProcessingHeader
        document={document}
        detailHref={detailHref}
        libraryHref={libraryHref}
        error={error}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ProcessingStatusPanel
          document={document}
          isLoading={isLoading}
          isRetrySubmitting={isRetrySubmitting}
          retryError={retryError}
          retryButtonRef={retryButtonRef}
          onRetryConfirm={() => {
            void handleRetryConfirm();
          }}
        />
        <ProcessingDocumentInfoPanel document={document} detailHref={detailHref} />
      </div>
    </div>
  );
}
