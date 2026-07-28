"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, CircleAlert, FileText, Loader2, RefreshCcw } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, LinkButton, StatusPill, TypeBadge } from "@/components/ui";
import { Phase0ClientError, getPhase0DocumentQuiz } from "@/lib/phase0/client";
import type { Phase0Document, Phase0DocumentQuizResponse } from "@/lib/phase0/contracts";
import { getDocumentFailurePresentation, isRetryableDocumentFailureCode } from "@/lib/phase0/document-failure";
import { routes } from "@/lib/routes";

interface DocumentDetailProps {
  readonly document: Phase0Document;
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

function getClientErrorMessage(error: unknown): string {
  if (error instanceof Phase0ClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Chưa thể kiểm tra quiz cho tài liệu này lúc này.";
}

export function DocumentDetail({ document }: DocumentDetailProps) {
  const [quizDiscovery, setQuizDiscovery] = useState<Phase0DocumentQuizResponse | null>(null);
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [quizUnavailable, setQuizUnavailable] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  const type = useMemo(() => mapType(document.type), [document.type]);
  const status = useMemo(() => mapStatus(document.status), [document.status]);
  const failurePresentation = useMemo(
    () => document.status === "FAILED" ? getDocumentFailurePresentation(document.errorCode) : null,
    [document.errorCode, document.status],
  );
  const canRetryFailure = useMemo(
    () => document.status === "FAILED" && isRetryableDocumentFailureCode(document.errorCode),
    [document.errorCode, document.status],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadQuizDiscovery(): Promise<void> {
      setIsQuizLoading(true);
      setQuizError(null);
      setQuizUnavailable(false);

      try {
        const response = await getPhase0DocumentQuiz(document.id);
        if (cancelled) {
          return;
        }
        setQuizDiscovery(response);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof Phase0ClientError && error.status === 404) {
          setQuizDiscovery(null);
          setQuizUnavailable(true);
        } else {
          setQuizError(getClientErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsQuizLoading(false);
        }
      }
    }

    void loadQuizDiscovery();

    return () => {
      cancelled = true;
    };
  }, [document.id]);

  const primaryAction = quizDiscovery
    ? { href: routes.quizStart(quizDiscovery.quizId), label: "Bắt đầu quiz" }
    : status === "processing"
      ? { href: routes.processing(document.id), label: "Theo dõi xử lý" }
      : canRetryFailure
        ? { href: routes.processing(document.id), label: "Mở lại trang xử lý" }
        : { href: routes.upload, label: "Tải tài liệu lên" };

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-brand-50 text-brand-600">
                <FileText className="h-6 w-6" aria-hidden />
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={type} />
                  <StatusPill status={status} />
                </div>
                <div>
                  <h2 className="break-words text-2xl font-semibold tracking-tight text-ink-900">
                    {document.originalName}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-ink-600">
                    Xem thông tin tài liệu, trạng thái hiện tại và quiz liên quan nếu đã có sẵn.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <LinkButton href={primaryAction.href}>{primaryAction.label}</LinkButton>
              <LinkButton href={routes.library} variant="outline">
                Về thư viện
              </LinkButton>
            </div>
          </div>

          {failurePresentation ? (
            <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">{failurePresentation.title}</p>
                  <p className="mt-1">{failurePresentation.description}</p>
                </div>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin tài liệu</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <SpecItem label="Loại tài liệu" value={document.type === "TEXT" ? "TXT" : "PDF"} />
            <SpecItem label="Kích thước" value={formatBytes(document.sizeBytes)} />
            <SpecItem label="Ngôn ngữ" value={document.language ?? "Chưa có"} />
            <SpecItem label="Tạo lúc" value={formatDateTime(document.createdAt)} />
            <SpecItem label="Cập nhật lúc" value={formatDateTime(document.updatedAt)} />
            <SpecItem label="Số trang" value={document.pageCount !== null ? String(document.pageCount) : "Chưa có"} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quiz liên quan</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {isQuizLoading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang kiểm tra quiz cho tài liệu này…
              </div>
            ) : null}

            {!isQuizLoading && quizDiscovery ? (
              <div className="space-y-4 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-brand-600">
                    <BookOpen className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">Quiz đã sẵn sàng</p>
                    <p className="mt-1 text-sm text-ink-700">
                      Số câu hỏi: <span className="font-medium text-ink-900">{quizDiscovery.questionCount}</span>
                    </p>
                  </div>
                </div>
                <LinkButton href={routes.quizStart(quizDiscovery.quizId)}>Bắt đầu quiz</LinkButton>
              </div>
            ) : null}

            {!isQuizLoading && quizUnavailable ? (
              <div className="rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-700">
                Tài liệu này chưa có quiz. Bạn có thể quay lại sau để kiểm tra lại.
              </div>
            ) : null}

            {!isQuizLoading && quizError ? (
              <div className="space-y-3 rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
                <p>{quizError}</p>
                <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                  <RefreshCcw className="h-4 w-4" />
                  Tải lại trang
                </Button>
              </div>
            ) : null}

            <div className="rounded-2xl border border-warning-100 bg-warning-50/60 p-4 text-sm leading-6 text-warning-800">
              Khi quiz đã sẵn sàng, bạn có thể mở ngay từ đây để bắt đầu làm bài.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-ink-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}
