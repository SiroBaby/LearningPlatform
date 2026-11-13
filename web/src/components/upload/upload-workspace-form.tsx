import { Loader2, Upload } from "lucide-react";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { formatBytes, getUploadStepLabel, getUploadTypeLabel, type SelectedPhase0File, type UploadSource, type UploadStep } from "./upload-workspace-utils";
import { UploadPickerSection } from "./upload-picker-section";
import { UploadSelectionBadges, UploadSpecItem } from "./upload-workspace-primitives";
import { UploadSourceSwitch } from "./upload-source-switch";

interface UploadWorkspaceFormProps {
  readonly fileInputId: string;
  readonly selectedFile: SelectedPhase0File | null;
  readonly validationError: string | null;
  readonly step: UploadStep;
  readonly canSubmit: boolean;
  readonly isMediaUploadEnabled: boolean;
  /** Shows the source switch; false keeps the page file-only. */
  readonly isYoutubeLessonsEnabled: boolean;
  readonly source: UploadSource;
  readonly isBusy: boolean;
  readonly onSourceChange: (source: UploadSource) => void;
  readonly onFileChange: (fileList: FileList | null) => void;
  readonly onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly youtubeSection: React.ReactNode;
  readonly youtubeConfirmSection: React.ReactNode;
  readonly modelSection: React.ReactNode;
  readonly estimateSection: React.ReactNode;
}

export function UploadWorkspaceForm({
  fileInputId,
  selectedFile,
  validationError,
  step,
  canSubmit,
  isMediaUploadEnabled,
  isYoutubeLessonsEnabled,
  source,
  isBusy,
  onSourceChange,
  onFileChange,
  onSubmit,
  youtubeSection,
  youtubeConfirmSection,
  modelSection,
  estimateSection,
}: UploadWorkspaceFormProps) {
  const isYoutube = source === "youtube";
  return (
    <Card className="overflow-hidden border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white">
      <CardBody className="space-y-6">
        <div className="space-y-3">
          <Badge tone="brand">Tải tài liệu</Badge>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
              {isYoutube
                ? "Tạo bài học từ video YouTube"
                : isMediaUploadEnabled ? "Tải file PDF, TXT, MP3 hoặc MP4" : "Tải file PDF hoặc TXT"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-600 sm:text-base">
              {isYoutube
                ? "Dán link video và chọn file phụ đề để chuẩn bị bài kiểm tra."
                : "Chọn tài liệu để hệ thống xử lý và chuẩn bị bài kiểm tra."}
            </p>
          </div>
        </div>

        <form className="space-y-5" onSubmit={(event) => {
          void onSubmit(event);
        }}>
          {isYoutubeLessonsEnabled ? (
            <UploadSourceSwitch source={source} isDisabled={isBusy} onChange={onSourceChange} />
          ) : null}

          {isYoutube ? youtubeSection : (
            <>
              <UploadPickerSection
                fileInputId={fileInputId}
                isMediaUploadEnabled={isMediaUploadEnabled}
                onFileChange={onFileChange}
              />
              <UploadSelectionBadges isMediaUploadEnabled={isMediaUploadEnabled} />
            </>
          )}

          {validationError ? (
            <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">{validationError}</div>
          ) : null}

          {selectedFile ? (
            <div className="grid gap-3 rounded-3xl border border-brand-100 bg-brand-50/60 p-4 sm:grid-cols-2">
              <UploadSpecItem label="Tên file" value={selectedFile.file.name} />
              <UploadSpecItem
                label="Loại tài liệu"
                value={getUploadTypeLabel(selectedFile.normalizedType)}
              />
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
                  ? "Đang tải file lên"
                  : step === "confirming"
                    ? "Đang chuyển sang xử lý"
                    : isYoutube ? "Tải phụ đề lên" : "Tải tài liệu lên"}
            </Button>
          </div>

          {youtubeConfirmSection}
        </form>
      </CardBody>
    </Card>
  );
}
