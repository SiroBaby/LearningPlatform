import { cn } from "@/lib/cn";

import type { UploadSource } from "./upload-workspace-utils";

interface UploadSourceSwitchProps {
  readonly source: UploadSource;
  readonly isDisabled: boolean;
  readonly onChange: (source: UploadSource) => void;
}

const SOURCE_OPTIONS: readonly { readonly value: UploadSource; readonly label: string }[] = [
  { value: "file", label: "Tải file" },
  { value: "youtube", label: "Video YouTube" },
];

export function UploadSourceSwitch({ source, isDisabled, onChange }: UploadSourceSwitchProps) {
  return (
    <div role="group" aria-label="Nguồn bài học" className="inline-flex rounded-xl border border-brand-100 bg-white p-1">
      {SOURCE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={source === option.value}
          disabled={isDisabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-10 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            source === option.value ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-brand-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
