import { Loader2, Upload } from "lucide-react";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { formatBytes, getUploadStepLabel, type SelectedPhase0File, type UploadStep } from "./upload-workspace-utils";
import { UploadPickerSection } from "./upload-picker-section";
import { UploadSelectionBadges, UploadSpecItem } from "./upload-workspace-primitives";

interface UploadWorkspaceFormProps {
  readonly fileInputId: string;
  readonly selectedFile: SelectedPhase0File | null;
  readonly validationError: string | null;
  readonly step: UploadStep;
  readonly canSubmit: boolean;
  readonly onFileChange: (fileList: FileList | null) => void;
  readonly onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly modelSection: React.ReactNode;
  readonly estimateSection: React.ReactNode;
}

export function UploadWorkspaceForm({
  fileInputId,
  selectedFile,
  validationError,
  step,
  canSubmit,
  onFileChange,
  onSubmit,
  modelSection,
  estimateSection,
}: UploadWorkspaceFormProps) {
  return (
    <Card className="overflow-hidden border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white">
      <CardBody className="space-y-6">
        <div className="space-y-3">
          <Badge tone="brand">Tải tài liệu</Badge>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Tải tệp PDF hoặc TXT</h2>
            <p className="mt-2 text-sm leading-6 text-ink-600 sm:text-base">
              Chọn tài liệu để hệ thống xử lý và chuẩn bị bài kiểm tra.
            </p>
          </div>
        </div>

        <form className="space-y-5" onSubmit={(event) => {
          void onSubmit(event);
        }}>
          <UploadPickerSection fileInputId={fileInputId} onFileChange={onFileChange} />
          <UploadSelectionBadges />

          {validationError ? (
            <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">{validationError}</div>
          ) : null}

          {selectedFile ? (
            <div className="grid gap-3 rounded-3xl border border-brand-100 bg-brand-50/60 p-4 sm:grid-cols-2">
              <UploadSpecItem label="Tên tệp" value={selectedFile.file.name} />
              <UploadSpecItem label="Loại tài liệu" value={selectedFile.normalizedType === "TEXT" ? "TXT" : "PDF"} />
              <UploadSpecItem label="Kích thước" value={formatBytes(selectedFile.file.size)} />
              <UploadSpecItem label="Trạng thái" value={getUploadStepLabel(step)} />
            </div>
          ) : null}

          {modelSection}
          {estimateSection}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!canSubmit}>
              {step === "creating" || step === "uploading" || step === "confirming" ? (
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
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
