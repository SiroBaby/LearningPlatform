import type { Metadata } from "next";
import { ListChecks } from "lucide-react";

import { AdminSamplePage } from "@/components/admin/admin-sample-page";
import { AdminShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Hoạt động",
  description: "Xem những hoạt động đáng chú ý trong hệ thống.",
};

export default function AdminActivityPage(): React.ReactNode {
  return (
    <AdminShell title="Hoạt động" subtitle="Xem những thay đổi và hoạt động đáng chú ý trong ngày.">
      <AdminSamplePage
        icon={ListChecks}
        title="Theo dõi những điều đang diễn ra"
        subtitle="Các chỉ số và danh sách dưới đây là mẫu giao diện để thống nhất cách hiển thị. Dữ liệu thật sẽ được kết nối ở bước tiếp theo."
        metrics={[
          { label: "Hoạt động hôm nay", value: "256", helper: "Lượt thao tác đáng chú ý" },
          { label: "Tài khoản mới", value: "18", helper: "Đăng ký trong ngày" },
          { label: "Yêu cầu cần xem", value: "7", helper: "Đang chờ xử lý" },
        ]}
        itemsTitle="Một vài hoạt động gần đây"
        itemsDescription="Mỗi dòng sẽ giúp bạn biết điều gì xảy ra và cần làm gì tiếp theo."
        items={[
          { title: "Tài khoản mới hoàn tất đăng ký", detail: "Một người học vừa bắt đầu sử dụng nền tảng.", status: "Đã ghi nhận" },
          { title: "Tài liệu mới được xử lý xong", detail: "Nội dung đã sẵn sàng cho người học.", status: "Đã hoàn tất" },
          { title: "Có yêu cầu thay đổi quyền", detail: "Mở phần Người dùng & quyền để xem.", status: "Cần xem" },
        ]}
      />
    </AdminShell>
  );
}
