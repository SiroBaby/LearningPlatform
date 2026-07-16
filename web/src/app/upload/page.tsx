import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { UploadWorkspace } from "@/components/upload/upload-workspace";

export const metadata: Metadata = {
  title: "Tải tài liệu lên",
  description:
    "Tải file PDF hoặc TXT để bắt đầu xử lý và tạo quiz từ tài liệu của bạn.",
};

export default function UploadPage() {
  return (
    <LearnerShell
      title="Tải tài liệu lên"
      subtitle="Chọn file PDF hoặc TXT để hệ thống xử lý và chuẩn bị quiz cho bạn."
    >
      <UploadWorkspace />
    </LearnerShell>
  );
}
