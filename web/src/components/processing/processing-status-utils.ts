import { useEffect, useRef, useState } from "react";
import { Phase0ClientError, getPhase0Document } from "@/lib/phase0/client";
import type { Phase0BudgetStatus, Phase0Document, Phase0ModelSelectionKind } from "@/lib/phase0/contracts";

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function mapType(type: Phase0Document["type"]): "pdf" | "text" {
  return type === "PDF" ? "pdf" : "text";
}

export function mapStatus(status: Phase0Document["status"]): "uploaded" | "processing" | "ready" | "failed" {
  switch (status) {
    case "UPLOADED":
      return "uploaded";
    case "PROCESSING":
      return "processing";
    case "READY":
      return "ready";
    case "FAILED":
      return "failed";
  }
}

export function getStatusLabel(status: Phase0Document["status"]): string {
  switch (status) {
    case "UPLOADED":
      return "Đã tải lên";
    case "PROCESSING":
      return "Đang xử lý";
    case "READY":
      return "Sẵn sàng";
    case "FAILED":
      return "Xử lý chưa thành công";
  }
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value);
}

export function getModelSourceLabel(kind: Phase0ModelSelectionKind | null): string {
  if (kind === "PLAN") {
    return "Có trong gói của bạn";
  }

  if (kind === "CUSTOM") {
    return "API riêng của bạn";
  }

  return "Chưa có";
}

export function getEstimateStatusLabel(document: Phase0Document | null): string {
  if (!document?.estimateStatus || document.estimatedCredits === null) {
    return "Chưa có";
  }

  if (document.selectedModelKind === "CUSTOM") {
    return "Không dùng credit trong gói";
  }

  return `Khoảng ${formatCredits(document.estimatedCredits)} credit`;
}

export function getSettledCreditsLabel(document: Phase0Document | null): string {
  if (document?.settledCredits === null || document?.settledCredits === undefined) {
    return document?.status === "FAILED" ? "Chưa ghi nhận" : "Đang chờ chốt";
  }

  return `${formatCredits(document.settledCredits)} credit`;
}

export function getBudgetStatusLabel(status: Phase0BudgetStatus | null): string {
  if (status === "WITHIN_BUDGET") {
    return "Trong mức dự kiến";
  }

  if (status === "EXCEEDED") {
    return "Vượt mức dự kiến";
  }

  return "Đang cập nhật";
}

export function getBudgetMessage(document: Phase0Document | null): string {
  if (!document) {
    return "Sau khi có thêm dữ liệu xử lý, trang này sẽ cập nhật mức ước tính và credit chốt cuối cùng.";
  }

  if (document.status === "FAILED") {
    return "Nếu tài liệu chưa xử lý xong, mức credit chốt có thể chưa xuất hiện hoặc chưa hoàn tất.";
  }

  if (document.selectedModelKind === "CUSTOM") {
    return "Model API riêng không dùng credit suy luận trong gói. Nhà cung cấp bạn chọn có thể tính phí riêng ngoài hệ thống này.";
  }

  if (document.settledCredits !== null) {
    return "Credit chốt cuối cùng đã được ghi nhận cho lần xử lý này.";
  }

  return "Mức credit đang hiển thị là ước tính ban đầu, chưa phải số chốt cuối cùng.";
}

function getClientErrorMessage(error: unknown): string {
  if (error instanceof Phase0ClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Chưa thể tải trạng thái tài liệu lúc này.";
}

interface UseProcessingDocumentStatusResult {
  readonly document: Phase0Document | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export function useProcessingDocumentStatus(documentId: string): UseProcessingDocumentStatusResult {
  const [document, setDocument] = useState<Phase0Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const nextDocument = await getPhase0Document(documentId);
        if (cancelled) {
          return;
        }

        setDocument(nextDocument);
        setError(null);

        if (nextDocument.status === "READY" || nextDocument.status === "FAILED") {
          setIsLoading(false);
          return;
        }
      } catch (pollError) {
        if (cancelled) {
          return;
        }

        setError(getClientErrorMessage(pollError));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }

      if (!cancelled) {
        pollingTimerRef.current = window.setTimeout(() => {
          void poll();
        }, 3000);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (pollingTimerRef.current !== null) {
        window.clearTimeout(pollingTimerRef.current);
      }
    };
  }, [documentId]);

  return {
    document,
    isLoading,
    error,
  };
}
