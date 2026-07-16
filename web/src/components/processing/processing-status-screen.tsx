"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LinkButton, StatusPill, TypeBadge } from "@/components/ui";
import { Phase0ClientError, getPhase0Document } from "@/lib/phase0/client";
import type { Phase0Document } from "@/lib/phase0/contracts";
import { routes } from "@/lib/routes";

interface ProcessingStatusScreenProps {
  readonly documentId: string;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatBytes(sizeBytes: number): string {
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

function mapType(type: Phase0Document["type"]): "pdf" | "text" {
  return type === "PDF" ? "pdf" : "text";
}

function mapStatus(status: Phase0Document["status"]): "uploaded" | "processing" | "ready" | "failed" {
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

function getStatusLabel(status: Phase0Document["status"]): string {
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

function getClientErrorMessage(error: unknown): string {
  if (error instanceof Phase0ClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Chưa thể tải trạng thái tài liệu lúc này.";
}

export function ProcessingStatusScreen({ documentId }: ProcessingStatusScreenProps) {
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

  const stableDetailHref = routes.document(documentId);
  const stableLibraryHref = routes.library;
  const mappedStatus = document ? mapStatus(document.status) : "uploaded";
  const mappedType = document ? mapType(document.type) : "pdf";

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {document ? <TypeBadge type={mappedType} /> : null}
                <StatusPill status={mappedStatus} />
                <Badge tone="brand">Tự cập nhật</Badge>
              </div>
              <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
                    {document?.originalName ?? "Đang tải trạng thái tài liệu"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    Tài liệu của bạn đang được xử lý. Khi xong, bạn có thể mở chi tiết để xem tiếp.
                  </p>

              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <LinkButton href={stableDetailHref}>Xem chi tiết tài liệu</LinkButton>
              <LinkButton href={stableLibraryHref} variant="outline">
                Về thư viện
              </LinkButton>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Trạng thái xử lý</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {isLoading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang cập nhật trạng thái tài liệu…
              </div>
            ) : null}

            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-ink-700">
              <p className="font-semibold text-ink-900">Trạng thái hiện tại</p>
              <p className="mt-1">
                {document ? getStatusLabel(document.status) : "Đang chờ cập nhật"}
              </p>
            </div>

            {document?.errorMessage ? (
              <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
                <p className="font-semibold">Không thể xử lý tài liệu</p>
                <p className="mt-1">{document.errorMessage}</p>
              </div>
            ) : null}

            <div className="rounded-2xl border border-warning-100 bg-warning-50/60 p-4 text-sm leading-6 text-warning-800">
              Nếu tài liệu vẫn đang xử lý, bạn có thể quay lại sau và mở lại trang này bất cứ lúc nào.
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thông tin tài liệu</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-ink-600">
            <SpecRow label="Tên file" value={document?.originalName ?? "Chưa có"} />
            <SpecRow label="Kích thước" value={document ? formatBytes(document.sizeBytes) : "Chưa có"} />
            <SpecRow label="Tạo lúc" value={document ? formatDateTime(document.createdAt) : "Chưa có"} />
            <SpecRow label="Cập nhật lúc" value={document ? formatDateTime(document.updatedAt) : "Chưa có"} />
            <SpecRow label="Ngôn ngữ" value={document?.language ?? "Chưa có"} />
            <SpecRow label="Số trang" value={document?.pageCount !== null && document?.pageCount !== undefined ? String(document.pageCount) : "Chưa có"} />
            <div className="flex flex-wrap gap-2 pt-2">
              <LinkButton href={stableDetailHref} size="sm">
                Xem chi tiết
              </LinkButton>
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                Cập nhật ngay
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 pb-3 last:border-b-0 last:pb-0">
      <dt>{label}</dt>
      <dd className="max-w-[60%] break-words text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
