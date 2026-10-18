import { ArrowRight, CheckCircle2, FileText, GraduationCap, PlayCircle, Quote, ShieldCheck, Sparkles } from "lucide-react";
import { PublicShell } from "@/components/layout";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationSnippet,
  LinkButton,
  ProgressBar,
  SectionHeading,
} from "@/components/ui";
import { citations } from "@/lib/mock-data";
import { routes } from "@/lib/routes";

const features = [
  {
    title: "Từ tài liệu thành quiz",
    description: "Tải lên slide, PDF hoặc ghi chú. Hệ thống tạo câu hỏi giúp bạn nhớ lâu, kèm lời giải và nguồn trích dẫn.",
    icon: FileText,
  },
  {
    title: "Video có điểm dừng",
    description: "Video tự dừng ở những đoạn quan trọng để hỏi bạn về phần vừa xem, thay vì chỉ xem thụ động.",
    icon: PlayCircle,
  },
  {
    title: "Trợ giảng bám sát tài liệu",
    description: "Trợ giảng chỉ trả lời khi tìm thấy căn cứ trong tài liệu của bạn, và cho bạn mở lại đúng đoạn gốc.",
    icon: Quote,
  },
  {
    title: "Danh sách ôn tập",
    description: "Tự gom câu sai, thẻ ghi nhớ đến hạn và phần còn yếu để bạn biết hôm nay nên học gì trước.",
    icon: Sparkles,
  },
];

export default function Home() {
  return (
    <PublicShell>
      <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div className="space-y-8">
            <Badge tone="brand">Học từ chính tài liệu của bạn, có nguồn rõ ràng</Badge>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
                Biến tài liệu học của bạn thành quiz và phản hồi có nguồn rõ ràng.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-ink-600">
                Tải lên PDF hoặc video bài giảng. Hệ thống tạo câu hỏi ôn tập kèm nguồn trích dẫn để bạn học, trả lời, nhận phản hồi và quay lại phần còn yếu nhanh hơn.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={routes.signup} size="lg">
                Dùng thử miễn phí <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={routes.examples} variant="outline" size="lg">
                Xem ví dụ
              </LinkButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric title="Sẵn sàng sau vài phút" value="PDF thành quiz" />
              <Metric title="Minh bạch" value="Nguồn trích dẫn hiển thị rõ" />
              <Metric title="Phù hợp với" value="Ôn thi" />
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf
                  </p>
                  <p className="mt-1 text-sm text-ink-500">
                    Tải lên, tạo câu hỏi, ôn lại phần yếu
                  </p>
                </div>
                <Badge tone="success">Sẵn sàng</Badge>
              </CardHeader>
              <CardBody className="space-y-5">
                <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-brand-700">Xem trước quiz</p>
                      <h3 className="mt-2 text-lg font-semibold text-ink-900">
                        Vì sao chuyển đổi ngữ cảnh làm tốn thêm tài nguyên của hệ thống?
                      </h3>
                    </div>
                    <Badge tone="mastery">Quiz</Badge>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {[
                      "Vì CPU phải lưu và khôi phục trạng thái tiến trình…",
                      "Vì tiến trình mới luôn cần nhiều bộ nhớ hơn",
                      "Vì hệ điều hành phải nạp lại chương trình từ đĩa",
                    ].map((option, index) => (
                      <div
                        key={option}
                        className={`rounded-xl border px-3 py-2.5 text-sm ${
                          index === 0
                            ? "border-brand-300 bg-white text-ink-900"
                            : "border-brand-100 bg-white/70 text-ink-600"
                        }`}
                      >
                        {option}
                      </div>
                    ))}
                  </div>
                  <CitationSnippet citation={citations.osContextSwitch} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="border-brand-100 bg-brand-50/60">
                    <CardBody className="space-y-2">
                      <p className="text-sm font-semibold text-brand-700">Tiến độ xử lý</p>
                      <ProgressBar value={84} />
                      <p className="text-sm text-ink-600">Đọc nội dung, tạo câu hỏi, kiểm tra lại</p>
                    </CardBody>
                  </Card>
                  <Card className="border-review-100 bg-review-50/70">
                    <CardBody className="space-y-2">
                      <p className="text-sm font-semibold text-review-600">Phát hiện chủ đề còn yếu</p>
                      <p className="text-sm text-ink-700">Đồng bộ tiến trình</p>
                      <p className="text-sm text-ink-600">Gợi ý: xem lại nguồn, làm lại câu sai, hỏi trợ giảng</p>
                    </CardBody>
                  </Card>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Cách hoạt động"
          title="Một vòng học rõ ràng"
          description="Tải tài liệu, nhận câu hỏi, trả lời, xem phản hồi, ôn lại phần yếu."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {features.map(({ title, description, icon: Icon }) => (
            <Card key={title}>
              <CardBody className="space-y-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{title}</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-16 sm:px-6 lg:grid-cols-3 lg:px-8">
          <TrustCard
            icon={ShieldCheck}
            title="Có nguồn trích dẫn, không trả lời mò"
            description="Mỗi câu hỏi, lời giải và câu trả lời của trợ giảng đều chỉ về trang, thời điểm hoặc đoạn gốc."
          />
          <TrustCard
            icon={CheckCircle2}
            title="Giao diện học tập gọn, dễ tập trung"
            description="Màn hình chỉ giữ những gì bạn cần để học, không rối mắt, không gây xao nhãng."
          />
          <TrustCard
            icon={GraduationCap}
            title="Thiết kế cho cách học của người Việt"
            description="Hỗ trợ tên môn dài, ôn thi và tài liệu lẫn Việt-Anh, dùng tốt trên điện thoại."
          />
        </div>
      </section>
    </PublicShell>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3 card-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{title}</p>
      <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
    </div>
  );
}

function TrustCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success-50 text-success-600">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
        </div>
      </CardBody>
    </Card>
  );
}
