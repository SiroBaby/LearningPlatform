import { FileUp } from "lucide-react";

interface UploadPickerSectionProps {
  readonly fileInputId: string;
  readonly onFileChange: (fileList: FileList | null) => void;
}

export function UploadPickerSection({ fileInputId, onFileChange }: UploadPickerSectionProps) {
  return (
    <div className="rounded-[calc(var(--radius-card)+6px)] border-2 border-dashed border-brand-200 bg-white/85 p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <FileUp className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-ink-900">Chọn file PDF hoặc TXT</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
          Chọn đúng file bạn muốn dùng. Sau khi tải lên xong, tài liệu sẽ được chuyển sang bước xử lý.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <label htmlFor={fileInputId} className="cursor-pointer">
            <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
              <FileUp className="h-4 w-4" />
              Chọn file
            </span>
          </label>
        </div>
        <input
          id={fileInputId}
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files)}
        />
      </div>
    </div>
  );
}
