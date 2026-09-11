import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { UploadWorkspace } from "@/components/upload/upload-workspace";

const isMediaUploadEnabled = process.env.MEDIA_UPLOADS_ENABLED === "true";

export const metadata: Metadata = {
  title: "Tải tài liệu lên",
  description: isMediaUploadEnabled
    ? "Tải tệp PDF, TXT, MP3 hoặc MP4 để bắt đầu xử lý và tạo bài kiểm tra từ tài liệu của bạn."
    : "Tải tệp PDF hoặc TXT để bắt đầu xử lý và tạo bài kiểm tra từ tài liệu của bạn.",
};

export default function UploadPage() {
  return (
    <LearnerShell
      title="Tải tài liệu lên"
      subtitle={isMediaUploadEnabled
        ? "Chọn tệp PDF, TXT, MP3 hoặc MP4 để hệ thống xử lý và chuẩn bị bài kiểm tra cho bạn."
        : "Chọn tệp PDF hoặc TXT để hệ thống xử lý và chuẩn bị bài kiểm tra cho bạn."}
    >
      <UploadWorkspace isMediaUploadEnabled={isMediaUploadEnabled} />
    </LearnerShell>
  );
}
