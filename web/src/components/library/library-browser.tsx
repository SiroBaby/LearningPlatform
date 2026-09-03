"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileQuestion, FileText, Filter, Grid2x2, LayoutList, RefreshCcw, Search, Sparkles, Upload } from "lucide-react";
import { Badge, Button, EmptyState, LinkButton, SectionHeading, StatusPill, TypeBadge } from "@/components/ui";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getPhase0Documents } from "@/lib/phase0/client";
import type {
  Phase0Document,
  Phase0DocumentProcessingFailureCode,
  Phase0DocumentStatus,
  Phase0DocumentType,
} from "@/lib/phase0/contracts";
import { getDocumentFailurePresentation } from "@/lib/phase0/document-failure";
import { getPhase0UiErrorMessage } from "@/lib/phase0/ui-errors";
import { routes } from "@/lib/routes";

type LibraryView = "grid" | "list";
type SortKey = "recent" | "name" | "status" | "updated";

type SearchUpdateMode = "push" | "replace";

type DocumentTypeFilter = "all" | "PDF" | "TEXT";
type DocumentStatusFilter = "all" | Phase0DocumentStatus;

type Phase0DocumentPresentation = {
  id: string;
  originalName: string;
  type: "pdf" | "text";
  status: "uploaded" | "processing" | "ready" | "failed";
  sizeBytes: number;
  language: string | null;
  pageCount: number | null;
  durationSec: number | null;
  errorCode: Phase0DocumentProcessingFailureCode | null;
  createdAt: string;
  updatedAt: string;
};

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "recent", label: "Mới tạo" },
  { value: "updated", label: "Mới cập nhật" },
  { value: "name", label: "Tên A–Z" },
  { value: "status", label: "Trạng thái" },
];

const STATUS_ORDER: Readonly<Record<Phase0DocumentPresentation["status"], number>> = {
  ready: 0,
  processing: 1,
  uploaded: 2,
  failed: 3,
};

function mapDocumentType(type: Phase0DocumentType): Phase0DocumentPresentation["type"] {
  return type === "PDF" ? "pdf" : "text";
}

function mapDocumentStatus(status: Phase0DocumentStatus): Phase0DocumentPresentation["status"] {
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

function toPresentationDocument(document: Phase0Document): Phase0DocumentPresentation {
  return {
    id: document.id,
    originalName: document.originalName,
    type: mapDocumentType(document.type),
    status: mapDocumentStatus(document.status),
    sizeBytes: document.sizeBytes,
    language: document.language,
    pageCount: document.pageCount,
    durationSec: document.durationSec,
    errorCode: document.errorCode,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
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

function normalizeSort(rawValue: string | null): SortKey {
  if (rawValue === "updated" || rawValue === "name" || rawValue === "status") {
    return rawValue;
  }

  return "recent";
}

function normalizeView(rawValue: string | null): LibraryView {
  return rawValue === "list" ? "list" : "grid";
}

function normalizeTypeFilter(rawValue: string | null): DocumentTypeFilter {
  return rawValue === "PDF" || rawValue === "TEXT" ? rawValue : "all";
}

function normalizeStatusFilter(rawValue: string | null): DocumentStatusFilter {
  return rawValue === "UPLOADED" || rawValue === "PROCESSING" || rawValue === "READY" || rawValue === "FAILED"
    ? rawValue
    : "all";
}

function buildLibraryUrl(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

function sortDocuments(documents: readonly Phase0DocumentPresentation[], sortKey: SortKey): Phase0DocumentPresentation[] {
  return [...documents].sort((left, right) => {
    if (sortKey === "name") {
      return left.originalName.localeCompare(right.originalName, "vi");
    }

    if (sortKey === "status") {
      return STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    }

    if (sortKey === "updated") {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function filterDocuments(
  documents: readonly Phase0DocumentPresentation[],
  searchTerm: string,
  typeFilter: DocumentTypeFilter,
  statusFilter: DocumentStatusFilter,
): Phase0DocumentPresentation[] {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  return documents.filter((document) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      document.originalName.toLowerCase().includes(normalizedSearch) ||
      document.id.toLowerCase().includes(normalizedSearch) ||
      (document.language ?? "").toLowerCase().includes(normalizedSearch);

    const matchesType = typeFilter === "all" || (typeFilter === "PDF" ? document.type === "pdf" : document.type === "text");
    const matchesStatus = statusFilter === "all" || document.status === statusFilter.toLowerCase();

    return matchesSearch && matchesType && matchesStatus;
  });
}

function usePhase0Documents() {
  const [documents, setDocuments] = useState<readonly Phase0DocumentPresentation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDocuments(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getPhase0Documents();
        if (cancelled) {
          return;
        }
        setDocuments(response.map(toPresentationDocument));
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(getPhase0UiErrorMessage(loadError, "Chưa thể tải thư viện lúc này."));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return { documents, isLoading, error, retry: () => setReloadKey((currentKey) => currentKey + 1) };
}

function LibraryDocumentCard({
  document,
  view,
}: {
  document: Phase0DocumentPresentation;
  view: LibraryView;
}) {
  const isList = view === "list";
  const failurePresentation = document.status === "failed"
    ? getDocumentFailurePresentation(document.errorCode)
    : null;

  return (
    <Card className={cn("h-full", isList && "overflow-hidden")}>
      <CardBody
        className={cn(
          "gap-5",
          isList ? "grid items-start md:grid-cols-[minmax(0,1.7fr)_220px]" : "flex h-full flex-col",
        )}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <FileText className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={document.type} />
                <StatusPill status={document.status} />
              </div>
              <Link
                href={routes.document(document.id)}
                className="block break-words text-lg font-semibold leading-snug text-ink-900 hover:text-brand-700"
              >
                {document.originalName}
              </Link>
              <p className="text-sm text-ink-500">
                Tạo {formatDateTime(document.createdAt)} · Cập nhật {formatDateTime(document.updatedAt)}
              </p>
            </div>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <SpecItem label="Kích thước" value={formatBytes(document.sizeBytes)} />
            <SpecItem label="Ngôn ngữ" value={document.language ?? "Chưa có"} />
            <SpecItem label="Số trang" value={document.pageCount !== null ? String(document.pageCount) : "Chưa có"} />
          </dl>

          {document.status === "processing" ? (
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-3 text-sm text-brand-700">
              Tài liệu này vẫn đang được xử lý. Mở chi tiết để theo dõi thêm.
            </div>
          ) : null}

          {failurePresentation ? (
            <div className="rounded-2xl border border-error-100 bg-error-50 p-3 text-sm text-error-700">
              <p className="font-medium">{failurePresentation.title}</p>
              <p className="mt-1">{failurePresentation.description}</p>
            </div>
          ) : null}
        </div>

          <div className={cn("space-y-4", isList && "md:border-l md:border-ink-100 md:pl-5")}>
            <div className="rounded-2xl border border-ink-100 bg-ink-50 p-3 text-sm text-ink-600">
              <p className="font-medium text-ink-800">Tiếp theo</p>
              <p className="mt-1">
                Mở chi tiết để xem thêm thông tin và kiểm tra quiz đã sẵn sàng hay chưa.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <LinkButton href={routes.document(document.id)} size="sm">
                Xem chi tiết
              </LinkButton>
              {document.status === "processing" ? (
                <LinkButton href={routes.processing(document.id)} size="sm" variant="outline">
                  Theo dõi xử lý
                </LinkButton>
              ) : null}
              <LinkButton href={routes.upload} size="sm" variant="ghost">
                Tải tài liệu khác
              </LinkButton>
            </div>
          </div>

      </CardBody>
    </Card>
  );
}

export function LibraryBrowser() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { documents, isLoading, error, retry } = usePhase0Documents();

  const searchTerm = searchParams.get("q") ?? "";
  const typeFilter = normalizeTypeFilter(searchParams.get("type"));
  const statusFilter = normalizeStatusFilter(searchParams.get("status"));
  const sortKey = normalizeSort(searchParams.get("sort"));
  const view = normalizeView(searchParams.get("view"));

  const filteredDocuments = useMemo(
    () => sortDocuments(filterDocuments(documents, searchTerm, typeFilter, statusFilter), sortKey),
    [documents, searchTerm, sortKey, statusFilter, typeFilter],
  );

  const activeFilterCount = [typeFilter, statusFilter].filter((value) => value !== "all").length +
    (searchTerm.trim().length > 0 ? 1 : 0);

  function updateSearchParams(updates: Readonly<Record<string, string | null>>, mode: SearchUpdateMode): void {
    const nextParams = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === "all") {
        nextParams.delete(key);
        return;
      }

      nextParams.set(key, value);
    });

    const url = buildLibraryUrl(pathname, nextParams);

    if (mode === "replace") {
      window.history.replaceState(null, "", url);
      return;
    }

    window.history.pushState(null, "", url);
  }

  function clearFilters(): void {
    window.history.pushState(null, "", pathname);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <SectionHeading
            eyebrow="Thư viện tài liệu"
            title="Tài liệu của bạn"
            description="Tìm, lọc và sắp xếp tài liệu để mở lại nhanh hơn khi cần học hoặc làm quiz."
            action={
              <div className="flex flex-wrap gap-2">
                <LinkButton href={routes.upload}>
                  <Upload className="h-4 w-4" aria-hidden />
                  Tải tài liệu lên
                </LinkButton>
              </div>
            }
          />
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
            <label className="space-y-1.5 xl:col-span-1">
              <span className="text-sm font-medium text-ink-700">Tìm tài liệu</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => updateSearchParams({ q: event.target.value || null }, "replace")}
                  placeholder="Tìm theo tên file hoặc ngôn ngữ"
                  className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-10 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                />
              </div>
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-ink-700">Loại tài liệu</span>
              <select
                value={typeFilter}
                onChange={(event) => updateSearchParams({ type: event.target.value }, "push")}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <option value="all">Mọi loại</option>
                <option value="PDF">PDF</option>
                <option value="TEXT">Văn bản</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-ink-700">Trạng thái</span>
              <select
                value={statusFilter}
                onChange={(event) => updateSearchParams({ status: event.target.value }, "push")}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <option value="all">Mọi trạng thái</option>
                <option value="READY">Sẵn sàng</option>
                <option value="PROCESSING">Đang xử lý</option>
                <option value="UPLOADED">Đã tải lên</option>
                <option value="FAILED">Xử lý chưa thành công</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-ink-700">Sắp xếp</span>
              <select
                value={sortKey}
                onChange={(event) => updateSearchParams({ sort: event.target.value }, "push")}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-ink-100 bg-ink-50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-600" aria-live="polite">
              <Badge tone="brand">{filteredDocuments.length} tài liệu</Badge>
              <span className="inline-flex items-center gap-2">
                <Filter className="h-4 w-4" aria-hidden />
                {activeFilterCount > 0 ? `${activeFilterCount} bộ lọc đang bật` : "Đang xem toàn bộ thư viện"}
              </span>
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-md text-sm font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  Xóa bộ lọc
                </button>
              ) : null}
            </div>

            <div className="inline-flex rounded-xl border border-ink-200 bg-white p-1">
              <button
                type="button"
                onClick={() => updateSearchParams({ view: "grid" }, "push")}
                aria-pressed={view === "grid"}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
                  view === "grid" ? "bg-brand-50 text-brand-700" : "text-ink-600",
                )}
              >
                <Grid2x2 className="h-4 w-4" aria-hidden />
                Lưới
              </button>
              <button
                type="button"
                onClick={() => updateSearchParams({ view: "list" }, "push")}
                aria-pressed={view === "list"}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
                  view === "list" ? "bg-brand-50 text-brand-700" : "text-ink-600",
                )}
              >
                <LayoutList className="h-4 w-4" aria-hidden />
                Danh sách
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {error ? (
        <Card className="border-error-100 bg-error-50/70" role="alert">
          <CardBody className="flex flex-col gap-3 text-sm text-error-700 sm:flex-row sm:items-center sm:justify-between">
            <p>{error}</p>
            <Button type="button" variant="outline" onClick={() => void retry()} disabled={isLoading}>
              <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden />
              {isLoading ? "Đang thử lại…" : "Thử lại"}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {isLoading ? (
        <section
          aria-label="Danh sách tài liệu đang tải"
          className={cn("gap-4", view === "grid" ? "grid md:grid-cols-2 xl:grid-cols-3" : "flex flex-col")}
        >
          {Array.from({ length: view === "grid" ? 6 : 3 }).map((_, index) => (
            <Card key={index}>
              <CardBody className="space-y-3">
                <div className="h-5 w-24 animate-pulse rounded bg-ink-100" />
                <div className="h-6 w-4/5 animate-pulse rounded bg-ink-100" />
                <div className="h-4 w-3/5 animate-pulse rounded bg-ink-100" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="h-16 animate-pulse rounded-2xl bg-ink-100" />
                  <div className="h-16 animate-pulse rounded-2xl bg-ink-100" />
                </div>
              </CardBody>
            </Card>
          ))}
        </section>
      ) : filteredDocuments.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Không có tài liệu nào khớp với bộ lọc này"
          description="Thử nới bộ lọc hoặc tải thêm tài liệu lên để xem tại đây."
          action={<LinkButton href={routes.upload}>Tải tài liệu lên</LinkButton>}
          secondaryAction={
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-ink-200 px-4 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Xóa bộ lọc
            </button>
          }
        />
      ) : (
        <section
          aria-label="Danh sách tài liệu"
          className={cn("gap-4", view === "grid" ? "grid md:grid-cols-2 xl:grid-cols-3" : "flex flex-col")}
        >
          {filteredDocuments.map((document) => (
            <LibraryDocumentCard key={document.id} document={document} view={view} />
          ))}
        </section>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-warning-50 text-warning-700">
              <FileQuestion className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink-900">Muốn tạo quiz mới?</h2>
              <p className="mt-1 text-sm text-ink-600">
                Tải thêm tài liệu lên, rồi mở trang chi tiết để kiểm tra quiz khi đã sẵn sàng.
              </p>
            </div>
          </div>
          <LinkButton href={routes.upload}>
            <Upload className="h-4 w-4" aria-hidden />
            Tải tài liệu lên
          </LinkButton>
        </CardBody>
      </Card>
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
