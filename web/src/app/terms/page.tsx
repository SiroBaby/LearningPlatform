import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/layout";
import { Badge, Card, CardBody, CardTitle } from "@/components/ui";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Các nguyên tắc sử dụng LearningPlatform, tài liệu người dùng, nội dung AI và giới hạn dịch vụ.",
};

export default function TermsPage() {
  return (
    <PublicShell>
      <article className="border-b border-ink-200 bg-gradient-to-b from-review-50 via-white to-white">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <Badge tone="review">Terms of Use</Badge>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            Điều khoản sử dụng LearningPlatform.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-ink-600">
            Các nguyên tắc dưới đây giúp việc dùng tài liệu, quiz và tính năng AI diễn ra minh bạch. Đây là bản mô tả sản phẩm hiện tại, không phải tư vấn pháp lý.
          </p>

          <div className="mt-10 space-y-5">
            <TermsSection title="1. Tài khoản và đăng nhập">
              <p>LearningPlatform dùng Google OAuth để xác thực. Bạn chịu trách nhiệm bảo vệ tài khoản Google và không được chia sẻ cookie hoặc session của mình cho người khác.</p>
              <p className="mt-3">Mỗi người chỉ được sử dụng tài nguyên trong phạm vi tài khoản đã xác thực. Việc cố ý truy cập tài liệu, quiz hoặc kết quả của người khác là không được phép.</p>
            </TermsSection>

            <TermsSection title="2. Tài liệu và quyền sử dụng nội dung">
              <p>Bạn chỉ tải lên nội dung mà bạn có quyền sử dụng hoặc được phép xử lý. Bạn giữ quyền đối với tài liệu của mình; việc tải lên không chuyển quyền sở hữu nội dung cho LearningPlatform.</p>
              <p className="mt-3">Bạn không được dùng dịch vụ để tải lên nội dung vi phạm pháp luật, xâm phạm quyền riêng tư, chứa mã độc hoặc cố tình vượt giới hạn kỹ thuật.</p>
            </TermsSection>

            <TermsSection title="3. Nội dung do AI tạo">
              <p>Quiz, giải thích, phản hồi và gợi ý học tập được tạo tự động từ tài liệu cung cấp. Nội dung có thể không hoàn toàn chính xác; citation giúp bạn kiểm tra lại nguồn trước khi dùng cho quyết định học tập quan trọng.</p>
              <p className="mt-3">LearningPlatform không cam kết kết quả điểm số, chứng chỉ hoặc kết quả học tập cụ thể. Bạn chịu trách nhiệm đánh giá nội dung trước khi sử dụng.</p>
            </TermsSection>

            <TermsSection title="4. Giới hạn và thay đổi dịch vụ">
              <p>Dịch vụ có thể áp dụng giới hạn file, thời gian xử lý, quota hoặc credits theo capability và plan. Một số luồng có thể tạm thời không khả dụng khi provider hoặc hạ tầng gặp sự cố.</p>
              <p className="mt-3">Tính năng, giới hạn và nội dung điều khoản có thể được cập nhật khi sản phẩm thay đổi. Phiên bản mới sẽ được công bố trên trang này.</p>
            </TermsSection>

            <Card className="border-review-100 bg-review-50/70">
              <CardBody>
                <CardTitle>Câu hỏi về điều khoản</CardTitle>
                <p className="mt-2 text-sm leading-6 text-ink-700">Liên hệ <a className="font-medium text-brand-700 underline underline-offset-4" href="mailto:ngocphat076@gmail.com">ngocphat076@gmail.com</a>. Bạn cũng có thể đọc <Link className="font-medium text-brand-700 underline underline-offset-4" href={routes.privacy}>Chính sách quyền riêng tư</Link>.</p>
              </CardBody>
            </Card>
          </div>
        </div>
      </article>
    </PublicShell>
  );
}

function TermsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
      <div className="mt-3 text-sm leading-7 text-ink-700">{children}</div>
    </section>
  );
}
