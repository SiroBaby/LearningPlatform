import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { UploadWorkspace } from "@/components/upload/upload-workspace";

export const metadata: Metadata = {
  title: "Tải tài liệu lên",
  description:
    "Tải tệp PDF hoặc TXT để bắt đầu xử lý và tạo bài kiểm tra từ tài liệu của bạn.",
};

export default function UploadPage() {
  return (
    <LearnerShell
      title="Tải tài liệu lên"
      subtitle="Chọn tệp PDF hoặc TXT để hệ thống xử lý và chuẩn bị bài kiểm tra cho bạn."
    >
      <UploadWorkspace />
    </LearnerShell>
  );
}
