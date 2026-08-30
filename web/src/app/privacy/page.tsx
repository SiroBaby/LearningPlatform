import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/layout";
import { Badge, Card, CardBody, CardTitle } from "@/components/ui";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Quyền riêng tư",
  description: "Cách LearningPlatform xử lý thông tin tài khoản Google, phiên đăng nhập, tài liệu và dữ liệu học tập.",
};

export default function PrivacyPage() {
  return (
    <PublicShell>
      <article className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <Badge tone="brand">Privacy Policy</Badge>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            Quyền riêng tư, viết rõ để bạn biết dữ liệu đi đâu.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-ink-600">
            Trang này mô tả cách LearningPlatform dự kiến xử lý dữ liệu trong phiên bản hiện tại. Đây là thông tin sản phẩm, không phải tư vấn pháp lý.
          </p>

          <div className="mt-10 space-y-5">
            <PolicySection title="1. Thông tin tài khoản Google">
              <p>Khi bạn chọn đăng nhập bằng Google, hệ thống nhận các trường cần thiết để xác định tài khoản:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Google `sub` — mã định danh ổn định của tài khoản Google.</li>
                <li>Email và trạng thái email đã được Google xác minh.</li>
                <li>Tên hiển thị và ảnh đại diện nếu Google cung cấp.</li>
              </ul>
              <p className="mt-3">Email chỉ là thuộc tính hồ sơ; quyền sở hữu tài nguyên dựa trên mã Google `sub` đã xác minh.</p>
            </PolicySection>

            <PolicySection title="2. Phiên đăng nhập và cookie">
              <p>LearningPlatform dùng cookie phiên `HttpOnly` để giữ đăng nhập. Cookie không được JavaScript phía trình duyệt đọc trực tiếp. Phiên truy cập ngắn hạn và phiên làm mới có thời hạn riêng; đăng xuất hoặc phát hiện token bị dùng lại sẽ thu hồi phiên phù hợp.</p>
              <p className="mt-3">Google authorization code, token, PKCE verifier và giá trị cookie không được ghi vào log ứng dụng.</p>
            </PolicySection>

            <PolicySection title="3. Tài liệu và dữ liệu học tập">
              <p>Tài liệu tải lên, quiz, câu trả lời và kết quả học tập được gắn với tài khoản của bạn. Các truy vấn user-facing phải kiểm tra quyền sở hữu; tài liệu mặc định không công khai.</p>
              <p className="mt-3">Dữ liệu xử lý nền có thể được giữ để bảo toàn trạng thái, idempotency và lịch sử grading. Chính sách retention hoặc xóa chi tiết có thể thay đổi theo từng capability và sẽ được cập nhật khi có tính năng quản lý dữ liệu tương ứng.</p>
            </PolicySection>

            <PolicySection title="4. Quyền kiểm soát và yêu cầu hỗ trợ">
              <p>Bạn có thể yêu cầu hỗ trợ về tài khoản hoặc dữ liệu bằng cách liên hệ chủ dự án tại <a className="font-medium text-brand-700 underline underline-offset-4" href="mailto:ngocphat076@gmail.com">ngocphat076@gmail.com</a>. Không gửi mật khẩu, token hoặc mã xác thực trong email.</p>
              <p className="mt-3">Yêu cầu xóa hoặc ẩn dữ liệu sẽ được xem xét theo trạng thái hệ thống và chính sách lưu giữ hiện hành; việc xóa identity không mặc nhiên xóa ngay lịch sử product/audit.</p>
            </PolicySection>

            <Card className="border-brand-100 bg-brand-50/60">
              <CardBody>
                <CardTitle>Đăng nhập bằng Google</CardTitle>
                <p className="mt-2 text-sm leading-6 text-ink-700">Bạn có thể xem <Link className="font-medium text-brand-700 underline underline-offset-4" href={routes.terms}>Điều khoản sử dụng</Link> trước khi tiếp tục.</p>
              </CardBody>
            </Card>
          </div>
        </div>
      </article>
    </PublicShell>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
      <div className="mt-3 text-sm leading-7 text-ink-700">{children}</div>
    </section>
  );
}
