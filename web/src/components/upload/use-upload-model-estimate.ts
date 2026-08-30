import { useEffect, useState } from "react";
import { estimatePhase0DocumentUpload, getPhase0ModelOptions, Phase0ClientError } from "@/lib/phase0/client";
import type {
  Phase0EstimateResponse,
  Phase0ModelOption,
  Phase0ModelOptionGroup,
  Phase0UploadModelSelection,
} from "@/lib/phase0/contracts";
import {
  findModelOption,
  getModelSourceLabel,
  getModelLabel,
  getEstimateSummary,
  groupModelOptions,
  type SelectedPhase0File,
  type UploadModelChoice,
} from "./upload-workspace-utils";

function getClientErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Phase0ClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

interface UseUploadModelEstimateParams {
  readonly selectedFile: SelectedPhase0File | null;
  readonly selectedModel: UploadModelChoice | null;
  readonly uploadSelection: Phase0UploadModelSelection | null;
  readonly estimateRequestId: number;
}

interface UseUploadModelEstimateResult {
  readonly modelOptions: readonly Phase0ModelOption[];
  readonly groupedModelOptions: readonly Phase0ModelOptionGroup[];
  readonly selectedModelOption: Phase0ModelOption | null;
  readonly isLoadingModels: boolean;
  readonly modelOptionsError: string | null;
  readonly estimate: Phase0EstimateResponse | null;
  readonly estimateError: string | null;
  readonly isEstimating: boolean;
  readonly setEstimate: (estimate: Phase0EstimateResponse | null) => void;
  readonly setEstimateError: (error: string | null) => void;
  readonly setIsEstimating: (value: boolean) => void;
}

export function useUploadModelEstimate({
  selectedFile,
  selectedModel,
  uploadSelection,
  estimateRequestId,
}: UseUploadModelEstimateParams): UseUploadModelEstimateResult {
  const [modelOptions, setModelOptions] = useState<readonly Phase0ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelOptionsError, setModelOptionsError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Phase0EstimateResponse | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadModelOptions(): Promise<void> {
      setIsLoadingModels(true);
      setModelOptionsError(null);

      try {
        const models = await getPhase0ModelOptions();
        if (cancelled) {
          return;
        }

        setModelOptions(models);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setModelOptions([]);
        setModelOptionsError(
          getClientErrorMessage(error, "Chưa tải được danh sách cách xử lý lúc này. Bạn hãy thử lại."),
        );
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      }
    }

    void loadModelOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedFile || !uploadSelection) {
      return;
    }

    const currentFile = selectedFile;
    const currentSelection = uploadSelection;
    let cancelled = false;
    const requestId = estimateRequestId;

    async function requestEstimate(): Promise<void> {
      try {
        const nextEstimate = await estimatePhase0DocumentUpload({
          type: currentFile.normalizedType,
          sizeBytes: currentFile.file.size,
          ...currentSelection,
        });
        if (cancelled || requestId !== estimateRequestId) {
          return;
        }

        setEstimate(nextEstimate);
      } catch (error) {
        if (cancelled || requestId !== estimateRequestId) {
          return;
        }

        setEstimate(null);
        setEstimateError(
          getClientErrorMessage(error, "Chưa ước tính được chi phí cho lựa chọn này. Bạn hãy thử lại."),
        );
      } finally {
        if (!cancelled && requestId === estimateRequestId) {
          setIsEstimating(false);
        }
      }
    }

    void requestEstimate();

    return () => {
      cancelled = true;
    };
  }, [estimateRequestId, selectedFile, uploadSelection]);

  return {
    modelOptions,
    groupedModelOptions: groupModelOptions(modelOptions),
    selectedModelOption: findModelOption(modelOptions, selectedModel),
    isLoadingModels,
    modelOptionsError,
    estimate,
    estimateError,
    isEstimating,
    setEstimate,
    setEstimateError,
    setIsEstimating,
  };
}

export type UploadEstimateSummaryPresentation = {
  readonly modelLabel: string;
  readonly modelSourceLabel: string;
  readonly summary: string;
  readonly detail: string;
  readonly badgeTone: "brand" | "neutral";
  readonly badgeLabel: string;
};

export function toUploadEstimateSummaryPresentation(
  estimate: Phase0EstimateResponse,
): UploadEstimateSummaryPresentation {
  return {
    modelLabel: getModelLabel(estimate.selectedModelLabel),
    modelSourceLabel: getModelSourceLabel(estimate.selectedModelKind),
    summary: getEstimateSummary(estimate),
    detail: estimate.selectedModelKind === "PLAN"
      ? `Hiện đang hiển thị mức ước tính khoảng ${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(estimate.estimatedCredits)} lượt dùng. Đây chưa phải mức chốt cuối cùng.`
      : "Kết nối riêng không dùng lượt dùng trong gói. Nhà cung cấp bạn dùng có thể tính phí riêng ngoài hệ thống này.",
    badgeTone: estimate.selectedModelKind === "PLAN" ? "brand" : "neutral",
    badgeLabel: estimate.selectedModelKind === "PLAN" ? "Có trong gói của bạn" : "Kết nối riêng của bạn",
  };
}
