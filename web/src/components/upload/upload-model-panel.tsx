import { SelectField } from "@/components/ui";
import type { Phase0ModelOptionGroup } from "@/lib/phase0/contracts";
import { serializeModelChoice, type UploadModelChoice } from "./upload-workspace-utils";

interface UploadModelPanelProps {
  readonly modelSelectId: string;
  readonly selectedModel: UploadModelChoice | null;
  readonly groupedModelOptions: readonly Phase0ModelOptionGroup[];
  readonly isLoadingModels: boolean;
  readonly modelOptionsError: string | null;
  readonly onChange: (value: string) => void;
}

export function UploadModelPanel({
  modelSelectId,
  selectedModel,
  groupedModelOptions,
  isLoadingModels,
  modelOptionsError,
  onChange,
}: UploadModelPanelProps) {
  return (
    <div className="space-y-4 rounded-3xl border border-ink-100 bg-white/90 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ink-900">Chọn model xử lý</h3>
        <p className="text-sm leading-6 text-ink-600">Bạn cần chọn model trước khi tải tài liệu lên.</p>
      </div>

      <SelectField
        id={modelSelectId}
        label="Model dùng để xử lý"
        value={serializeModelChoice(selectedModel)}
        onChange={(event) => onChange(event.target.value)}
        disabled={isLoadingModels || groupedModelOptions.length === 0}
        error={!selectedModel && !isLoadingModels && groupedModelOptions.length > 0 ? "Hãy chọn một model để tiếp tục." : undefined}
        hint={isLoadingModels ? "Đang tải danh sách model…" : "Model trong gói và API riêng sẽ được nhóm riêng để bạn dễ chọn."}
      >
        <option value="">Chọn model phù hợp</option>
        {groupedModelOptions.map((group) => (
          <optgroup key={group.kind} label={group.title}>
            {group.options.map((option) => (
              <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>

      <div className="grid gap-3 sm:grid-cols-2">
        {groupedModelOptions.map((group) => (
          <div key={group.kind} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
            <p className="text-sm font-semibold text-ink-900">{group.title}</p>
            <p className="mt-1 text-sm leading-6 text-ink-600">{group.description}</p>
          </div>
        ))}
      </div>

      {modelOptionsError ? (
        <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">{modelOptionsError}</div>
      ) : null}

      {!isLoadingModels && groupedModelOptions.length === 0 && !modelOptionsError ? (
        <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4 text-sm text-warning-800">
          Hiện chưa có model nào sẵn sàng cho tài khoản của bạn.
        </div>
      ) : null}
    </div>
  );
}
