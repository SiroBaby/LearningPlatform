import type { Metadata } from "next";
import { Activity } from "lucide-react";

import { AdminSamplePage } from "@/components/admin/admin-sample-page";
import { AdminShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Tình trạng hệ thống",
  description: "Xem nhanh tình trạng các phần quan trọng của nền tảng.",
};

export default function AdminHealthPage(): React.ReactNode {
  return (
    <AdminShell title="Tình trạng hệ thống" subtitle="Xem nhanh nền tảng có đang sẵn sàng phục vụ người học không.">
      <AdminSamplePage
        icon={Activity}
        title="Một nền tảng khỏe giúp việc học không bị gián đoạn"
        subtitle="Các chỉ số dưới đây là mẫu giao diện để bạn hình dung cách đọc tình trạng hệ thống. Dữ liệu thật sẽ được kết nối ở bước tiếp theo."
        metrics={[
          { label: "Tình trạng chung", value: "Ổn định", helper: "Các chức năng chính đang hoạt động" },
          { label: "Xử lý tài liệu", value: "Tốt", helper: "Tài liệu tiếp tục được xử lý" },
          { label: "Việc cần theo dõi", value: "0", helper: "Chưa có cảnh báo mới" },
        ]}
        itemsTitle="Các phần quan trọng"
        itemsDescription="Khi có dữ liệu thật, mỗi mục sẽ hiển thị trạng thái và hướng xử lý phù hợp."
        items={[
          { title: "Nền tảng học tập", detail: "Người học có thể truy cập các chức năng chính.", status: "Ổn định" },
          { title: "Xử lý nội dung", detail: "Tài liệu mới có thể tiếp tục được chuẩn bị.", status: "Ổn định" },
          { title: "Theo dõi lỗi", detail: "Chưa có nhóm lỗi cần ưu tiên.", status: "Ổn định" },
        ]}
      />
    </AdminShell>
  );
}
