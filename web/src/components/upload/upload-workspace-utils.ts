import type {
  Phase0DocumentType,
  Phase0EstimateResponse,
  Phase0ModelOption,
  Phase0ModelOptionGroup,
  Phase0UploadModelSelection,
} from "@/lib/phase0/contracts";
import { formatVietnameseDateTime } from "@/lib/date-time";

export type UploadStep = "idle" | "creating" | "uploading" | "uploaded" | "confirming" | "confirmed";

export type SelectedPhase0File = {
  readonly file: File;
  readonly normalizedType: Phase0DocumentType;
};

export interface UploadModelChoice {
  readonly kind: Phase0ModelOption["kind"];
  readonly id: string;
}

export const MAX_DOCUMENT_SIZE_BYTES = 1024 * 1024 * 1024;
export const MAX_MP3_SIZE_BYTES = 300 * 1024 * 1024;
export const MAX_MP4_SIZE_BYTES = 500 * 1024 * 1024;
export const MAX_MEDIA_DURATION_SECONDS = 2 * 60 * 60;

type UploadFilePolicy = {
  readonly type: Phase0DocumentType;
  readonly label: string;
  readonly extension: string;
  readonly acceptedMimeTypes: readonly string[];
  readonly maxSizeBytes: number;
  readonly maxSizeLabel: string;
};

const UPLOAD_FILE_POLICIES: readonly UploadFilePolicy[] = [
  {
    type: "PDF",
    label: "PDF",
    extension: "pdf",
    acceptedMimeTypes: ["application/pdf"],
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    maxSizeLabel: "1 GiB",
  },
  {
    type: "TEXT",
    label: "TXT",
    extension: "txt",
    acceptedMimeTypes: ["text/plain"],
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    maxSizeLabel: "1 GiB",
  },
  {
    type: "AUDIO",
    label: "MP3",
    extension: "mp3",
    acceptedMimeTypes: ["audio/mpeg"],
    maxSizeBytes: MAX_MP3_SIZE_BYTES,
    maxSizeLabel: "300 MiB",
  },
  {
    type: "VIDEO",
    label: "MP4",
    extension: "mp4",
    acceptedMimeTypes: ["video/mp4"],
    maxSizeBytes: MAX_MP4_SIZE_BYTES,
    maxSizeLabel: "500 MiB",
  },
];

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
  return formatVietnameseDateTime(iso);
}

function getExtension(name: string): string {
  const segments = name.split(".");
  return segments.length > 1 ? segments.at(-1)?.toLowerCase() ?? "" : "";
}

function getUploadFilePolicy(extension: string): UploadFilePolicy | null {
  return UPLOAD_FILE_POLICIES.find((policy) => policy.extension === extension) ?? null;
}

export function getUploadTypeLabel(type: Phase0DocumentType): string {
  return UPLOAD_FILE_POLICIES.find((policy) => policy.type === type)?.label ?? type;
}

export function normalizeFileSelection(file: File): SelectedPhase0File | { readonly error: string } {
  const extension = getExtension(file.name);
  const mime = file.type.trim().toLowerCase();
  const policy = getUploadFilePolicy(extension);

  if (file.size <= 0) {
    return { error: "Tệp này đang trống nên chưa thể tải lên." };
  }

  if (!policy) {
    return { error: "Hiện chỉ hỗ trợ tệp PDF, TXT, MP3 hoặc MP4." };
  }

  if (mime.length > 0 && !policy.acceptedMimeTypes.includes(mime)) {
    return {
      error: `Định dạng tệp không khớp với phần mở rộng .${extension}. Hãy chọn đúng tệp ${policy.label} gốc.`,
    };
  }

  if (file.size > policy.maxSizeBytes) {
    return {
      error: `Tệp ${policy.label} vượt giới hạn ${policy.maxSizeLabel}. Hãy giảm dung lượng rồi tải lại.`,
    };
  }

  return {
    file,
    normalizedType: policy.type,
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
        ? `Không thể tải tệp lên: ${detail}`
        : "Không thể tải tệp lên. Hãy thử lại sau.",
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
      description: "Dùng lựa chọn sẵn có trong gói hiện tại.",
      options: planOptions,
    },
    {
      kind: "CUSTOM",
      title: "Kết nối riêng của bạn",
      description: "Dùng lựa chọn từ kết nối riêng của bạn.",
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
  return kind === "PLAN" ? "Có trong gói của bạn" : "Kết nối riêng của bạn";
}

export function getModelLabel(label: string): string {
  return label === "Fast platform model" ? "Mô hình xử lý nhanh" : label;
}

export function getEstimateSummary(estimate: Phase0EstimateResponse): string {
  if (estimate.selectedModelKind === "CUSTOM") {
    return "Tài liệu này không dùng lượt dùng trong gói. Nhà cung cấp kết nối riêng của bạn có thể tính phí riêng.";
  }

  return `Ước tính khoảng ${formatCredits(estimate.estimatedCredits)} lượt dùng cho lần này.`;
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
