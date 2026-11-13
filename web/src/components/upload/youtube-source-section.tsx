import { FileUp } from "lucide-react";

import { TextField } from "@/components/ui";

import { SUBTITLE_FILE_ACCEPT } from "./subtitle-file";

interface YoutubeSourceSectionProps {
  readonly urlInputId: string;
  readonly fileInputId: string;
  readonly youtubeUrl: string;
  /** Null while the field is empty or the link is accepted. */
  readonly urlError: string | null;
  readonly onUrlChange: (value: string) => void;
  readonly onSubtitleFileChange: (fileList: FileList | null) => void;
}

export function YoutubeSourceSection({
  urlInputId,
  fileInputId,
  youtubeUrl,
  urlError,
  onUrlChange,
  onSubtitleFileChange,
}: YoutubeSourceSectionProps) {
  return (
    <div className="space-y-5 rounded-[calc(var(--radius-card)+6px)] border-2 border-dashed border-brand-200 bg-white/85 p-6">
      <TextField
        id={urlInputId}
        label="Link video YouTube"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://www.youtube.com/watch?v=…"
        value={youtubeUrl}
        error={urlError ?? undefined}
        onChange={(event) => onUrlChange(event.target.value)}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink-700">File phụ đề của video</p>
        <p className="text-sm text-ink-600">Chọn file .vtt hoặc .srt, tối đa 5 MB.</p>
        <label htmlFor={fileInputId} className="inline-block cursor-pointer">
          <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
            <FileUp className="h-4 w-4" />
            Chọn file phụ đề
          </span>
        </label>
        <input
          id={fileInputId}
          type="file"
          aria-label="Chọn file phụ đề .vtt hoặc .srt"
          accept={SUBTITLE_FILE_ACCEPT}
          className="sr-only"
          onChange={(event) => onSubtitleFileChange(event.target.files)}
        />
      </div>
    </div>
  );
}
