import type {
  Phase0EstimateResponse,
  Phase0ModelOption,
  Phase0ModelOptionGroup,
  Phase0UploadModelSelection,
} from "@/lib/phase0/contracts";

export type UploadStep = "idle" | "creating" | "uploading" | "uploaded" | "confirming" | "confirmed";

export type SelectedPhase0File = {
  readonly file: File;
  readonly normalizedType: "PDF" | "TEXT";
};

export interface UploadModelChoice {
  readonly kind: Phase0ModelOption["kind"];
  readonly id: string;
}

const ACCEPTED_EXTENSIONS = new Set(["pdf", "txt"]);
const ACCEPTED_MIME_TYPES = new Set(["application/pdf", "text/plain"]);
export const ESTIMATE_HELPER_TEXT = "Đây là ước tính ban đầu để bạn cân nhắc trước khi tải lên. Chi phí thực tế có thể thay đổi sau khi xử lý xong.";

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

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function getExtension(name: string): string {
  const segments = name.split(".");
  return segments.length > 1 ? segments.at(-1)?.toLowerCase() ?? "" : "";
}

export function normalizeFileSelection(file: File): SelectedPhase0File | { readonly error: string } {
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
      error: "Không đọc được đúng định dạng của tệp này. Hãy chọn lại file PDF hoặc TXT gốc.",
    };
  }

  return {
    file,
    normalizedType: extension === "pdf" ? "PDF" : "TEXT",
  };
}

export async function uploadFileToStorage(
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

export function groupModelOptions(models: readonly Phase0ModelOption[]): readonly Phase0ModelOptionGroup[] {
  const planOptions = models.filter((model): model is Extract<Phase0ModelOption, { kind: "PLAN" }> => model.kind === "PLAN");
  const customOptions = models.filter((model): model is Extract<Phase0ModelOption, { kind: "CUSTOM" }> => model.kind === "CUSTOM");

  const groups: Phase0ModelOptionGroup[] = [
    {
      kind: "PLAN",
      title: "Có trong gói của bạn",
      description: "Dùng model sẵn có trong gói hiện tại.",
      options: planOptions,
    },
    {
      kind: "CUSTOM",
      title: "API riêng của bạn",
      description: "Dùng model từ cấu hình riêng của bạn.",
      options: customOptions,
    },
  ];

  return groups.filter((group) => group.options.length > 0);
}

export function serializeModelChoice(choice: UploadModelChoice | null): string {
  return choice ? `${choice.kind}:${choice.id}` : "";
}

export function parseModelChoice(value: string): UploadModelChoice | null {
  if (!value) {
    return null;
  }

  const [kind, ...rest] = value.split(":");
  const id = rest.join(":").trim();
  if (!id) {
    return null;
  }

  if (kind === "PLAN" || kind === "CUSTOM") {
    return { kind, id };
  }

  return null;
}

export function findModelOption(
  models: readonly Phase0ModelOption[],
  choice: UploadModelChoice | null,
): Phase0ModelOption | null {
  if (!choice) {
    return null;
  }

  return models.find((model) => model.kind === choice.kind && model.id === choice.id) ?? null;
}

export function buildUploadSelection(choice: UploadModelChoice | null): Phase0UploadModelSelection | null {
  if (!choice) {
    return null;
  }

  return choice.kind === "PLAN"
    ? { modelSelectionKind: "PLAN", platformModelId: choice.id }
    : { modelSelectionKind: "CUSTOM", customModelConfigId: choice.id };
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value);
}

export function getModelSourceLabel(kind: Phase0ModelOption["kind"]): string {
  return kind === "PLAN" ? "Có trong gói của bạn" : "API riêng của bạn";
}

export function getEstimateSummary(estimate: Phase0EstimateResponse): string {
  if (estimate.selectedModelKind === "CUSTOM") {
    return "Tài liệu này không dùng credit suy luận trong gói. Nhà cung cấp model riêng của bạn có thể tính phí riêng.";
  }

  return `Ước tính khoảng ${formatCredits(estimate.estimatedCredits)} credit cho lần xử lý này.`;
}

export function getUploadStepLabel(step: UploadStep): string {
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
