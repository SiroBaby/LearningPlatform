"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FileUp, Loader2, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { confirmPhase0Document, createPhase0UploadUrl } from "@/lib/phase0/client";
import { routes } from "@/lib/routes";

type UploadStep = "idle" | "creating" | "uploading" | "uploaded" | "confirming" | "confirmed";

type SelectedPhase0File = {
  file: File;
  normalizedType: "PDF" | "TEXT";
};

const ACCEPTED_EXTENSIONS = new Set(["pdf", "txt"]);
const ACCEPTED_MIME_TYPES = new Set(["application/pdf", "text/plain"]);

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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function getExtension(name: string): string {
  const segments = name.split(".");
  return segments.length > 1 ? segments.at(-1)?.toLowerCase() ?? "" : "";
}

function normalizeFileSelection(file: File): SelectedPhase0File | { error: string } {
  const extension = getExtension(file.name);
  const mime = file.type.trim().toLowerCase();
  const extensionAllowed = ACCEPTED_EXTENSIONS.has(extension);
  const mimeAllowed = mime.length === 0 || ACCEPTED_MIME_TYPES.has(mime);

  if (file.size <= 0) {
    return { error: "Tệp này đang trống nên chưa thể tải lên." };
  }

  if (!extensionAllowed) {
    return { error: "Hiện chỉ hỗ trợ file PDF hoặc TXT." };
  }

  if (!mimeAllowed) {
    return {
      error:
        "Không đọc được đúng định dạng của tệp này. Hãy chọn lại file PDF hoặc TXT gốc.",
    };
  }

  return {
    file,
    normalizedType: extension === "pdf" ? "PDF" : "TEXT",
  };
}

async function uploadFileToStorage(
  uploadUrl: string,
  uploadFields: Readonly<Record<string, string>>,
  file: File,
): Promise<void> {
  const formData = new FormData();

  for (const [key, value] of Object.entries(uploadFields)) {
    formData.append(key, value);
  }

  formData.append("file", file);

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const responseText = await response.text();
    const detail = responseText.trim();
    throw new Error(
      detail.length > 0
        ? `Storage upload failed: ${response.status} ${response.statusText} — ${detail}`
        : `Storage upload failed: ${response.status} ${response.statusText}`,
    );
  }
}

function getClientErrorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

function getUploadStepLabel(step: UploadStep): string {
  switch (step) {
    case "idle":
      return "Sẵn sàng tải lên";
    case "creating":
      return "Đang chuẩn bị";
    case "uploading":
      return "Đang tải tệp lên";
    case "uploaded":
      return "Đã tải tệp lên";
    case "confirming":
      return "Đang chuyển sang xử lý";
    case "confirmed":
      return "Đã chuyển sang xử lý";
  }
}

export function UploadWorkspace() {
  const router = useRouter();
  const fileInputId = useId();
  const [selectedFile, setSelectedFile] = useState<SelectedPhase0File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);

  const canSubmit = selectedFile !== null && step !== "creating" && step !== "uploading" && step !== "confirming";

  const statusTone = useMemo<"brand" | "success" | "warning">(() => {
    if (step === "confirmed") {
      return "success";
    }

    if (storageError || confirmError || validationError) {
      return "warning";
    }

    return "brand";
  }, [confirmError, step, storageError, validationError]);

  function resetFlowState(): void {
    setStep("idle");
    setDocumentId(null);
    setCreatedAt(null);
    setStorageError(null);
    setConfirmError(null);
    setConfirmStatus(null);
  }

  function handleFileChange(fileList: FileList | null): void {
    const nextFile = fileList?.[0];
    resetFlowState();

    if (!nextFile) {
      setSelectedFile(null);
      setValidationError(null);
      return;
    }

    const normalized = normalizeFileSelection(nextFile);
    if ("error" in normalized) {
      setSelectedFile(null);
      setValidationError(normalized.error);
      return;
    }

    setSelectedFile(normalized);
    setValidationError(null);
  }

  async function runConfirm(documentIdToConfirm: string): Promise<void> {
    setStep("confirming");
    setConfirmError(null);

    try {
      const confirmed = await confirmPhase0Document(documentIdToConfirm);
      setConfirmStatus(confirmed.status);
      setStep("confirmed");
      router.push(routes.processing(confirmed.documentId));
    } catch (error) {
      setStep("uploaded");
      setConfirmError(
        getClientErrorMessage(
          error,
          "Tệp đã tải lên xong nhưng chưa thể chuyển sang bước xử lý. Bạn hãy thử lại.",
        ),
      );
    }
  }

  async function handleUploadSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedFile) {
      setValidationError("Hãy chọn file PDF hoặc TXT trước khi tiếp tục.");
      return;
    }

    resetFlowState();
    setSelectedFile(selectedFile);
    setStep("creating");

    let upload;
    try {
      upload = await createPhase0UploadUrl({
        originalName: selectedFile.file.name,
        type: selectedFile.normalizedType,
        sizeBytes: selectedFile.file.size,
      });
    } catch (error) {
      setStorageError(getClientErrorMessage(error, "Chưa thể bắt đầu tải tệp lên. Hãy thử lại."));
      setStep("idle");
      return;
    }

    setDocumentId(upload.documentId);
    setCreatedAt(new Date().toISOString());
    setStep("uploading");
    try {
      await uploadFileToStorage(upload.uploadUrl, upload.uploadFields, selectedFile.file);
    } catch (error) {
      setStorageError(getClientErrorMessage(error, "Chưa thể tải tệp lên. Hãy thử lại sau."));
      setStep("idle");
      return;
    }

    setStep("uploaded");
    await runConfirm(upload.documentId);
  }

  async function handleRetryConfirm(): Promise<void> {
    if (!documentId) {
      return;
    }

    await runConfirm(documentId);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="overflow-hidden border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white">
          <CardBody className="space-y-6">
            <div className="space-y-3">
              <Badge tone="brand">Tải tài liệu</Badge>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
                  Tải file PDF hoặc TXT
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink-600 sm:text-base">
                  Chọn tài liệu của bạn để hệ thống xử lý và chuẩn bị quiz.
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={handleUploadSubmit}>
              <div className="rounded-[calc(var(--radius-card)+6px)] border-2 border-dashed border-brand-200 bg-white/85 p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                    <FileUp className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-ink-900">
                    Chọn file PDF hoặc TXT
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
                    Chọn đúng file bạn muốn dùng. Sau khi tải lên xong, tài liệu sẽ được chuyển sang bước xử lý.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <label htmlFor={fileInputId} className="cursor-pointer">
                      <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
                        <Upload className="h-4 w-4" />
                        Chọn file
                      </span>
                    </label>
                  </div>
                  <input
                    id={fileInputId}
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    className="sr-only"
                    onChange={(event) => handleFileChange(event.target.files)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">PDF</Badge>
                <Badge tone="neutral">TXT</Badge>
              </div>

              {validationError ? (
                <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
                  {validationError}
                </div>
              ) : null}

              {selectedFile ? (
                <div className="grid gap-3 rounded-3xl border border-brand-100 bg-brand-50/60 p-4 sm:grid-cols-2">
                  <SpecItem label="Tên file" value={selectedFile.file.name} />
                  <SpecItem label="Loại tài liệu" value={selectedFile.normalizedType === "TEXT" ? "TXT" : "PDF"} />
                  <SpecItem label="Kích thước" value={formatBytes(selectedFile.file.size)} />
                  <SpecItem label="Trạng thái" value={getUploadStepLabel(step)} />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={!canSubmit}>
                  {(step === "creating" || step === "uploading" || step === "confirming") ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {step === "creating"
                    ? "Đang chuẩn bị"
                    : step === "uploading"
                      ? "Đang tải tệp lên"
                      : step === "confirming"
                        ? "Đang chuyển sang xử lý"
                        : "Tải tài liệu lên"}
                </Button>
                {confirmError && documentId ? (
                  <Button type="button" variant="outline" onClick={handleRetryConfirm}>
                    <RefreshCcw className="h-4 w-4" />
                    Thử lại
                  </Button>
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-brand-700">Trạng thái hiện tại</p>
              <CardTitle>Theo dõi quá trình tải lên</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="rounded-3xl border border-ink-100 bg-ink-50/70 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-brand-600">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">Tiến trình tải lên</p>
                    <Badge tone={statusTone}>
                      {step === "idle" ? "Đang chờ file" : getUploadStepLabel(step)}
                    </Badge>
                  </div>
                  <p className="text-sm leading-6 text-ink-700">
                    Tại đây bạn sẽ thấy tài liệu đang ở bước nào và có cần thử lại hay không.
                  </p>
                </div>
              </div>
            </div>

            <dl className="space-y-3 text-sm">
              <SpecRow label="Bắt đầu lúc" value={createdAt ? formatDateTime(createdAt) : "Chưa bắt đầu"} />
              <SpecRow label="Đã tải tệp lên" value={step === "uploaded" || step === "confirming" || step === "confirmed" ? "Đã xong" : "Chưa"} />
              <SpecRow label="Bước xử lý" value={confirmStatus ?? (confirmError ? "Chưa thể tiếp tục" : "Chưa có")} />
            </dl>

            {storageError ? (
              <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>{storageError}</span>
                </div>
              </div>
            ) : null}

            {confirmError ? (
              <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4 text-sm text-warning-800">
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Tệp đã tải lên nhưng chưa chuyển sang xử lý</p>
                    <p className="mt-1">{confirmError}</p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-ink-100 bg-white p-4 text-sm leading-6 text-ink-700">
              Hỗ trợ file <span className="font-semibold text-ink-900">PDF</span> và <span className="font-semibold text-ink-900">TXT</span>. Nếu có lỗi, bạn chỉ cần chọn lại file hoặc thử tải lên lần nữa.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/90 p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-ink-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-ink-600">{label}</dt>
      <dd className="max-w-[60%] break-words text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
