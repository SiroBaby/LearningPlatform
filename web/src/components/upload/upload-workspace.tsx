"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseYoutubeVideoId } from "@/lib/media-playback/youtube-video-id";
import {
  confirmPhase0Document,
  createPhase0UploadUrl,
  Phase0ClientError,
  previewPhase0Subtitle,
} from "@/lib/phase0/client";
import type { Phase0ConfirmDocumentRequest, Phase0SubtitlePreviewResponse } from "@/lib/phase0/contracts";
import { getSubtitleErrorMessage } from "@/lib/phase0/subtitle-errors";
import { getInsufficientCreditsMessage } from "@/lib/phase0/ui-errors";
import { routes } from "@/lib/routes";
import { normalizeSubtitleSelection } from "./subtitle-file";
import { UploadEstimatePanel } from "./upload-estimate-panel";
import { UploadModelPanel } from "./upload-model-panel";
import { UploadStatusPanel } from "./upload-status-panel";
import { UploadWorkspaceForm } from "./upload-workspace-form";
import { YoutubeConfirmSection } from "./youtube-confirm-section";
import { YoutubeSourceSection } from "./youtube-source-section";
import {
  buildUploadSelection,
  normalizeFileSelection,
  parseModelChoice,
  uploadFileToStorage,
  type SelectedPhase0File,
  type UploadModelChoice,
  type UploadSource,
  type UploadStep,
} from "./upload-workspace-utils";
import { useUploadModelEstimate } from "./use-upload-model-estimate";

const BUSY_OR_PAST_UPLOAD_STEPS: ReadonlySet<UploadStep> = new Set<UploadStep>([
  "creating",
  "uploading",
  "previewing",
  "previewed",
  "confirming",
]);

function getClientErrorMessage(error: unknown, fallback: string): string {
  const insufficientCreditsMessage = getInsufficientCreditsMessage(error);
  if (insufficientCreditsMessage) {
    return insufficientCreditsMessage;
  }

  const subtitleMessage = error instanceof Phase0ClientError ? getSubtitleErrorMessage(error) : null;
  if (subtitleMessage) {
    return subtitleMessage;
  }

  if (error instanceof Phase0ClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

interface UploadWorkspaceProps {
  readonly isMediaUploadEnabled: boolean;
  readonly isYoutubeLessonsEnabled: boolean;
}

const YOUTUBE_URL_INVALID_MESSAGE = "Link này không phải video YouTube. Kiểm tra lại link.";

export function UploadWorkspace({ isMediaUploadEnabled, isYoutubeLessonsEnabled }: UploadWorkspaceProps) {
  const router = useRouter();
  const fileInputId = useId();
  const youtubeUrlInputId = useId();
  const rightsInputId = useId();
  const modelSelectId = useId();
  const [estimateRequestId, setEstimateRequestId] = useState(0);
  const [selectedFile, setSelectedFile] = useState<SelectedPhase0File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<UploadModelChoice | null>(null);
  const [source, setSource] = useState<UploadSource>("file");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [subtitlePreview, setSubtitlePreview] = useState<Phase0SubtitlePreviewResponse | null>(null);
  const [isRightsConfirmed, setIsRightsConfirmed] = useState(false);

  const isYoutube = source === "youtube";
  const youtubeVideoId = useMemo(() => parseYoutubeVideoId(youtubeUrl), [youtubeUrl]);
  const youtubeUrlError = youtubeUrl.trim().length > 0 && youtubeVideoId === null ? YOUTUBE_URL_INVALID_MESSAGE : null;

  const uploadSelection = useMemo(() => buildUploadSelection(selectedModel), [selectedModel]);
  const {
    groupedModelOptions,
    selectedModelOption,
    isLoadingModels,
    modelOptionsError,
    estimate,
    estimateError,
    isEstimating,
    setEstimate,
    setEstimateError,
    setIsEstimating,
  } = useUploadModelEstimate({
    selectedFile,
    selectedModel,
    uploadSelection,
    estimateRequestId,
  });
  const hasValidEstimate = estimate !== null && estimateError === null;
  const canSubmit =
    selectedFile !== null
    && uploadSelection !== null
    && hasValidEstimate
    && !isLoadingModels
    && !isEstimating
    && (!isYoutube || youtubeVideoId !== null)
    && !BUSY_OR_PAST_UPLOAD_STEPS.has(step);
  const isBusy = step === "creating" || step === "uploading" || step === "previewing" || step === "confirming";
  const canConfirmYoutube = isYoutube
    && subtitlePreview !== null
    && isRightsConfirmed
    && (step === "previewed" || step === "uploaded");

  const statusTone = useMemo<"brand" | "success" | "warning">(() => {
    if (step === "confirmed") {
      return "success";
    }

    if (storageError || confirmError || validationError || modelOptionsError || estimateError) {
      return "warning";
    }

    return "brand";
  }, [confirmError, estimateError, modelOptionsError, step, storageError, validationError]);

  function bumpEstimateRequest(): void {
    setEstimateRequestId((currentValue) => currentValue + 1);
  }

  function resetFlowState(): void {
    setStep("idle");
    setDocumentId(null);
    setCreatedAt(null);
    setStorageError(null);
    setConfirmError(null);
    setConfirmStatus(null);
    setSubtitlePreview(null);
    setIsRightsConfirmed(false);
  }

  function clearSelectionState(): void {
    resetFlowState();
    bumpEstimateRequest();
    setEstimate(null);
    setEstimateError(null);
    setIsEstimating(false);
    setSelectedFile(null);
    setValidationError(null);
  }

  function handleSourceChange(nextSource: UploadSource): void {
    clearSelectionState();
    setSource(nextSource);
  }

  function handleYoutubeUrlChange(value: string): void {
    resetFlowState();
    setYoutubeUrl(value);
  }

  function handleFileChange(fileList: FileList | null): void {
    const nextFile = fileList?.[0];
    resetFlowState();
    bumpEstimateRequest();
    setEstimate(null);
    setEstimateError(null);

    if (!nextFile) {
      setIsEstimating(false);
      setSelectedFile(null);
      setValidationError(null);
      return;
    }

    setIsEstimating(selectedModel !== null);

    const normalized = isYoutube ? normalizeSubtitleSelection(nextFile) : normalizeFileSelection(nextFile);
    if ("error" in normalized) {
      setSelectedFile(null);
      setValidationError(normalized.error);
      return;
    }

    if (!isMediaUploadEnabled && (normalized.normalizedType === "AUDIO" || normalized.normalizedType === "VIDEO")) {
      setSelectedFile(null);
      setValidationError("Tính năng tải MP3/MP4 chưa sẵn sàng. Hiện bạn có thể tải PDF hoặc TXT.");
      return;
    }

    setSelectedFile(normalized);
    setValidationError(null);
  }

  function handleModelChange(nextValue: string): void {
    const nextSelection = parseModelChoice(nextValue);
    resetFlowState();
    bumpEstimateRequest();
    setEstimate(null);
    setEstimateError(null);
    setIsEstimating(selectedFile !== null && nextSelection !== null);
    setSelectedModel(nextSelection);
  }

  async function runPreview(documentIdToPreview: string): Promise<void> {
    setStep("previewing");
    try {
      setSubtitlePreview(await previewPhase0Subtitle(documentIdToPreview));
      setStep("previewed");
    } catch (error) {
      setStorageError(getClientErrorMessage(error, "Chưa đọc được phụ đề. Thử lại."));
      setStep("idle");
    }
  }

  async function runConfirm(documentIdToConfirm: string, request?: Phase0ConfirmDocumentRequest): Promise<void> {
    setStep("confirming");
    setConfirmError(null);

    try {
      const confirmed = await confirmPhase0Document(documentIdToConfirm, request);
      setConfirmStatus(confirmed.status);
      setStep("confirmed");
      router.push(routes.processing(confirmed.documentId));
    } catch (error) {
      setStep("uploaded");
      setConfirmError(
        getClientErrorMessage(
          error,
          "File đã tải lên nhưng chưa xử lý được. Thử lại.",
        ),
      );
    }
  }

  function getMissingFileMessage(): string {
    if (isYoutube) return "Chọn file phụ đề .vtt hoặc .srt để tiếp tục.";
    return isMediaUploadEnabled
      ? "Chọn file PDF, TXT, MP3 hoặc MP4 để tiếp tục."
      : "Chọn file PDF hoặc TXT để tiếp tục.";
  }

  async function handleUploadSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedFile) {
      setValidationError(getMissingFileMessage());
      return;
    }

    if (isYoutube && youtubeVideoId === null) {
      setValidationError(YOUTUBE_URL_INVALID_MESSAGE);
      return;
    }

    if (!uploadSelection) {
      setValidationError("Chọn cách xử lý trước khi tải lên.");
      return;
    }

    if (!estimate || estimateError) {
      setValidationError("Cần có ước tính hợp lệ trước khi tải tài liệu lên.");
      return;
    }

    resetFlowState();
    setValidationError(null);
    setStep("creating");

    let upload: Awaited<ReturnType<typeof createPhase0UploadUrl>>;
    try {
      upload = await createPhase0UploadUrl({
        originalName: selectedFile.file.name,
        type: selectedFile.normalizedType,
        sizeBytes: selectedFile.file.size,
        ...(isYoutube ? { youtubeUrl: youtubeUrl.trim() } : {}),
        ...uploadSelection,
      });
    } catch (error) {
      setStorageError(getClientErrorMessage(error, "Chưa thể bắt đầu tải file lên. Thử lại."));
      setStep("idle");
      return;
    }

    setDocumentId(upload.documentId);
    setCreatedAt(new Date().toISOString());
    setStep("uploading");
    try {
      await uploadFileToStorage(upload.uploadUrl, upload.uploadFields, selectedFile.file);
    } catch (error) {
      setStorageError(getClientErrorMessage(error, "Chưa thể tải file lên. Thử lại sau."));
      setStep("idle");
      return;
    }

    setStep("uploaded");
    if (isYoutube) {
      await runPreview(upload.documentId);
      return;
    }
    await runConfirm(upload.documentId);
  }

  async function handleRetryConfirm(): Promise<void> {
    if (!documentId) {
      return;
    }

    await runConfirm(documentId, isYoutube ? { rightsConfirmed: isRightsConfirmed } : undefined);
  }

  async function handleConfirmYoutube(): Promise<void> {
    if (!documentId || !canConfirmYoutube) {
      return;
    }

    await runConfirm(documentId, { rightsConfirmed: true });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <UploadWorkspaceForm
          fileInputId={fileInputId}
          selectedFile={selectedFile}
          validationError={validationError}
          step={step}
          canSubmit={canSubmit}
          isMediaUploadEnabled={isMediaUploadEnabled}
          isYoutubeLessonsEnabled={isYoutubeLessonsEnabled}
          source={source}
          isBusy={isBusy}
          onSourceChange={handleSourceChange}
          onFileChange={handleFileChange}
          onSubmit={handleUploadSubmit}
          youtubeSection={(
            <YoutubeSourceSection
              urlInputId={youtubeUrlInputId}
              fileInputId={fileInputId}
              youtubeUrl={youtubeUrl}
              urlError={youtubeUrlError}
              onUrlChange={handleYoutubeUrlChange}
              onSubtitleFileChange={handleFileChange}
            />
          )}
          youtubeConfirmSection={isYoutube && subtitlePreview !== null && documentId !== null ? (
            <YoutubeConfirmSection
              key={documentId}
              rightsInputId={rightsInputId}
              preview={subtitlePreview}
              isRightsConfirmed={isRightsConfirmed}
              canConfirm={canConfirmYoutube}
              isConfirming={step === "confirming"}
              onRightsChange={setIsRightsConfirmed}
              onConfirm={() => {
                void handleConfirmYoutube();
              }}
            />
          ) : null}
          modelSection={(
            <UploadModelPanel
              modelSelectId={modelSelectId}
              selectedModel={selectedModel}
              groupedModelOptions={groupedModelOptions}
              isLoadingModels={isLoadingModels}
              modelOptionsError={modelOptionsError}
              onChange={handleModelChange}
            />
          )}
          estimateSection={(
            <UploadEstimatePanel
              selectedModelLabel={selectedModelOption?.label ?? null}
              selectedModelKind={selectedModelOption?.kind ?? null}
              isEstimating={isEstimating}
              estimateError={estimateError}
              estimate={estimate}
            />
          )}
        />

        <UploadStatusPanel
          step={step}
          statusTone={statusTone}
          isMediaUploadEnabled={isMediaUploadEnabled}
          createdAt={createdAt}
          confirmStatus={confirmStatus}
          selectedModelLabel={selectedModelOption?.label ?? null}
          selectedModelKind={selectedModelOption?.kind ?? null}
          estimate={estimate}
          isEstimating={isEstimating}
          storageError={storageError}
          confirmError={confirmError}
          canRetryConfirm={Boolean(confirmError && documentId)}
          onRetryConfirm={() => {
            void handleRetryConfirm();
          }}
        />
      </div>
    </div>
  );
}
