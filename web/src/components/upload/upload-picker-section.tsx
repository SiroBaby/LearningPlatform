import { FileUp } from "lucide-react";

interface UploadPickerSectionProps {
  readonly fileInputId: string;
  readonly isMediaUploadEnabled: boolean;
  readonly onFileChange: (fileList: FileList | null) => void;
}

export function UploadPickerSection({ fileInputId, isMediaUploadEnabled, onFileChange }: UploadPickerSectionProps) {
  const supportedTypes = isMediaUploadEnabled ? "PDF, TXT, MP3 hoặc MP4" : "PDF hoặc TXT";

  return (
    <div className="rounded-[calc(var(--radius-card)+6px)] border-2 border-dashed border-brand-200 bg-white/85 p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <FileUp className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-ink-900">Chọn tệp {supportedTypes}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
          Chọn đúng tệp bạn muốn dùng. Sau khi tải lên xong, tài liệu sẽ được chuyển sang bước xử lý.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <label htmlFor={fileInputId} className="cursor-pointer">
            <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700">
              <FileUp className="h-4 w-4" />
              Chọn tệp
            </span>
          </label>
        </div>
        <input
          id={fileInputId}
          type="file"
          aria-label={`Chọn tệp ${supportedTypes}`}
          accept={isMediaUploadEnabled
            ? ".pdf,.txt,.mp3,.mp4,application/pdf,text/plain,audio/mpeg,video/mp4"
            : ".pdf,.txt,application/pdf,text/plain"}
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files)}
        />

        <div className="mt-6 w-full max-w-2xl rounded-2xl border border-brand-100 bg-brand-50/70 p-4 text-left text-sm leading-6 text-ink-700" role="note">
          <p className="font-semibold text-ink-900">Giới hạn trước khi tải lên</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            <li>PDF/TXT: tối đa 1 GiB</li>
            {isMediaUploadEnabled ? <li>MP3: tối đa 300 MiB</li> : null}
            {isMediaUploadEnabled ? <li>MP4: tối đa 500 MiB</li> : null}
            {isMediaUploadEnabled ? <li>Media: thời lượng tối đa 2 giờ</li> : null}
          </ul>
          <p className="mt-3 text-warning-800">
            Nếu mạng không ổn định, lần tải lại sẽ bắt đầu từ đầu; hiện chưa hỗ trợ tiếp tục từ phần đã tải.
          </p>
          {isMediaUploadEnabled ? (
            <p className="mt-1 text-ink-600">
              MP4 cần video H.264 và âm thanh AAC-LC; video 4K hoặc 60 fps chưa được hỗ trợ.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
