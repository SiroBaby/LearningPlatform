"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getPhase0DocumentQuiz, Phase0ClientError, retryPhase0Document } from "@/lib/phase0/client";
import type { Phase0DocumentQuizResponse } from "@/lib/phase0/contracts";
import { getPhase0UiErrorMessage } from "@/lib/phase0/ui-errors";
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
  const [quizDiscovery, setQuizDiscovery] = useState<Phase0DocumentQuizResponse | null>(null);
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizReloadKey, setQuizReloadKey] = useState(0);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousRetryErrorRef = useRef<string | null>(null);
  const handleRetry = useMemo(() => createDocumentProcessingRetryAction({
    documentId,
    refresh,
    setRetryError,
    setIsRetrySubmitting,
    retryDocument: retryPhase0Document,
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

  useEffect(() => {
    if (document?.status !== "READY") {
      return;
    }

    let cancelled = false;
    const readyDocumentId = document.id;

    async function loadQuizDiscovery(): Promise<void> {
      setIsQuizLoading(true);
      setQuizDiscovery(null);
      setQuizError(null);

      try {
        const response = await getPhase0DocumentQuiz(readyDocumentId);
        if (!cancelled) {
          setQuizDiscovery(response);
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (error instanceof Phase0ClientError && error.status === 404) {
          setQuizError("Quiz đang được chuẩn bị. Hãy thử cập nhật lại sau ít phút.");
        } else {
          setQuizError(getPhase0UiErrorMessage(error, "Chưa thể mở quiz lúc này. Hãy thử lại sau."));
        }
      } finally {
        if (!cancelled) {
          setIsQuizLoading(false);
        }
      }
    }

    queueMicrotask(() => {
      if (!cancelled) {
        void loadQuizDiscovery();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [document?.id, document?.status, quizReloadKey]);

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
              void handleRetry();
            }}
            quizDiscovery={quizDiscovery}
            isQuizLoading={isQuizLoading}
            quizError={quizError}
            onRetryQuiz={() => setQuizReloadKey((currentKey) => currentKey + 1)}
          />
        <ProcessingDocumentInfoPanel document={document} detailHref={detailHref} />
      </div>
    </div>
  );
}
