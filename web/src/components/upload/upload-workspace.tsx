"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmPhase0Document,
  createPhase0UploadUrl,
  Phase0ClientError,
} from "@/lib/phase0/client";
import { routes } from "@/lib/routes";
import { UploadEstimatePanel } from "./upload-estimate-panel";
import { UploadModelPanel } from "./upload-model-panel";
import { UploadStatusPanel } from "./upload-status-panel";
import { UploadWorkspaceForm } from "./upload-workspace-form";
import {
  buildUploadSelection,
  normalizeFileSelection,
  parseModelChoice,
  uploadFileToStorage,
  type SelectedPhase0File,
  type UploadModelChoice,
  type UploadStep,
} from "./upload-workspace-utils";
import { useUploadModelEstimate } from "./use-upload-model-estimate";

function getClientErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Phase0ClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function UploadWorkspace() {
  const router = useRouter();
  const fileInputId = useId();
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
    && step !== "creating"
    && step !== "uploading"
    && step !== "confirming";

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

    const normalized = normalizeFileSelection(nextFile);
    if ("error" in normalized) {
      setSelectedFile(null);
      setValidationError(normalized.error);
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
      setValidationError("Hãy chọn tệp PDF hoặc TXT trước khi tiếp tục.");
      return;
    }

    if (!uploadSelection) {
      setValidationError("Hãy chọn cách xử lý trước khi tải tài liệu lên.");
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
        ...uploadSelection,
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
        <UploadWorkspaceForm
          fileInputId={fileInputId}
          selectedFile={selectedFile}
          validationError={validationError}
          step={step}
          canSubmit={canSubmit}
          onFileChange={handleFileChange}
          onSubmit={handleUploadSubmit}
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
