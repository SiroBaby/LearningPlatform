"use client";

import { useState } from "react";
import { ArrowRight, CircleCheck, Clock3, Sparkles, Video } from "lucide-react";
import { usage } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LinkButton, useToast } from "@/components/ui";

interface PlanCard {
  readonly id: string;
  readonly name: string;
  readonly monthlyPrice: string;
  readonly yearlyPrice: string;
  readonly credits: string;
  readonly uploads: string;
  readonly maxFile: string;
  readonly tutor: string;
  readonly analytics: string;
  readonly video: string;
  readonly highlight?: boolean;
  readonly features: readonly string[];
}

const planCards: readonly PlanCard[] = [
  {
    id: "free",
    name: "Miễn phí",
    monthlyPrice: "0₫",
    yearlyPrice: "0₫",
    credits: "100 / tháng",
    uploads: "10 tài liệu / tháng",
    maxFile: "Tài liệu ngắn",
    tutor: "Giới hạn mỗi ngày",
    analytics: "Cơ bản",
    video: "Video ngắn",
    features: [
      "Phù hợp để thử tải tài liệu, tạo bài kiểm tra và xem kết quả",
      "Cảnh báo khi chạm giới hạn lượt dùng hoặc dung lượng tệp",
      "Không phù hợp với video dài hoặc tạo lại nội dung nhiều lần",
    ],
  },
  {
    id: "student-plus",
    name: "Student Plus",
    monthlyPrice: "129.000₫",
    yearlyPrice: "1.290.000₫",
    credits: "450 / tháng",
    uploads: "50 tài liệu mỗi tháng",
    maxFile: "PDF, audio và video cỡ vừa",
    tutor: "Không giới hạn theo ngày",
    analytics: "Theo dõi tiến độ đầy đủ",
    video: "Điểm dừng và bản chép lời",
    highlight: true,
    features: [
      "Tăng lượt dùng cho giai đoạn ôn thi cường độ cao",
      "Mở điểm dừng trong video và công cụ ôn thi đầy đủ",
      "Phù hợp với sinh viên có nhiều tài liệu theo môn học",
    ],
  },
  {
    id: "pro-learner",
    name: "Pro Learner",
    monthlyPrice: "249.000₫",
    yearlyPrice: "2.490.000₫",
    credits: "1.000 / tháng",
    uploads: "Không giới hạn mềm",
    maxFile: "Video dài / khóa học lớn",
    tutor: "Ưu tiên cao",
    analytics: "Xu hướng nâng cao và kế hoạch ôn thi",
    video: "Xử lý nhiều tài liệu cùng lúc",
    features: [
      "Dành cho người học nhiều môn cùng lúc",
      "Nhiều lượt dùng hơn để tạo lại nội dung, hỏi trợ giảng và luyện đề",
      "Phù hợp khi bạn học với ứng dụng hằng ngày",
    ],
  },
] as const;

const featureRows = [
  {
    label: "Lượt dùng AI",
    values: ["100 / tháng", "450 / tháng", "1.000 / tháng"],
  },
  {
    label: "Tải lên, trang và thời lượng",
    values: ["10 tài liệu · giới hạn nhỏ", "50 tài liệu · mức vừa", "Fair use mềm · mức cao"],
  },
  {
    label: "Xử lý video",
    values: ["Video ngắn", "Có", "Có, xử lý nhiều tài liệu"],
  },
  {
    label: "Trợ giảng",
    values: ["Giới hạn ngày", "Không giới hạn", "Không giới hạn + ưu tiên"],
  },
  {
    label: "Theo dõi tiến độ",
    values: ["Cơ bản", "Đầy đủ", "Lập kế hoạch nâng cao"],
  },
  {
    label: "Khi dùng hết lượt",
    values: ["Nâng cấp gói", "Mua thêm lượt hoặc nâng cấp", "Mua thêm lượt linh hoạt"],
  },
] as const;

export function UpgradeScreen() {
  const { notify } = useToast();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlanId, setSelectedPlanId] = useState("student-plus");

  function upgradeToSelectedPlan(): void {
    const plan = planCards.find((item) => item.id === selectedPlanId);

    if (!plan) {
      return;
    }

    notify(`Bạn đã chọn gói ${plan.name}. Thanh toán chưa được mở trong phiên bản này.`, "success");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-5 card-shadow">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">Gợi ý phù hợp</Badge>
              <Badge tone="warning">Gói hiện tại: {usage.planLabel === "Free" ? "Miễn phí" : usage.planLabel}</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900">
              Chọn gói trước khi bắt đầu buổi học dài
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600">
              Bạn đang chuẩn bị thi, lượt dùng còn thấp và có video trong môn học hiện tại. Student Plus cân bằng giữa chi phí, số lượt dùng, trợ giảng và theo dõi tiến độ.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-ink-200 bg-ink-50 p-1">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                billingCycle === "monthly"
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              Theo tháng
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("yearly")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                billingCycle === "yearly"
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              Theo năm
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {planCards.map((plan) => {
          const isSelected = selectedPlanId === plan.id;
          const price = billingCycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;

          return (
            <Card key={plan.id} className={plan.highlight ? "border-brand-200" : undefined}>
              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{plan.name}</CardTitle>
                      {plan.highlight ? <Badge tone="brand">Phù hợp để ôn thi</Badge> : null}
                    </div>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{price}</p>
                    <p className="mt-1 text-sm text-ink-500">{billingCycle === "yearly" ? "Tính theo năm" : "Tính theo tháng"}</p>
                  </div>
                  {plan.id === usage.planTier ? <Badge tone="warning">Đang dùng</Badge> : null}
                </div>
                <div className="space-y-2 text-sm text-ink-600">
                  <p><span className="font-medium text-ink-900">Lượt dùng:</span> {plan.credits}</p>
                  <p><span className="font-medium text-ink-900">Tài liệu:</span> {plan.uploads}</p>
                  <p><span className="font-medium text-ink-900">Tệp hỗ trợ:</span> {plan.maxFile}</p>
                  <p><span className="font-medium text-ink-900">Trợ giảng:</span> {plan.tutor}</p>
                  <p><span className="font-medium text-ink-900">Theo dõi tiến độ:</span> {plan.analytics}</p>
                  <p><span className="font-medium text-ink-900">Video:</span> {plan.video}</p>
                </div>
              </CardHeader>
              <CardBody className="space-y-4">
                <ul className="space-y-2 text-sm leading-6 text-ink-600">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CircleCheck className="mt-1 h-4 w-4 shrink-0 text-success-600" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isSelected ? "secondary" : "outline"}
                  className="w-full"
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  {isSelected ? "Đã chọn" : "Chọn gói này"}
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>So sánh các gói</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              So sánh rõ giới hạn và quyền lợi trước khi bạn quyết định nâng cấp.
            </p>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-ink-600">
              <thead>
                <tr className="border-b border-ink-100 text-ink-900">
                  <th className="py-3 pr-4 font-semibold">Quyền lợi</th>
                  <th className="px-4 py-3 font-semibold">Miễn phí</th>
                  <th className="px-4 py-3 font-semibold">Student Plus</th>
                  <th className="px-4 py-3 font-semibold">Pro Learner</th>
                </tr>
              </thead>
              <tbody>
                {featureRows.map((row) => (
                  <tr key={row.label} className="border-b border-ink-100 last:border-b-0">
                    <td className="py-3 pr-4 font-medium text-ink-900">{row.label}</td>
                    {row.values.map((value) => (
                      <td key={`${row.label}-${value}`} className="px-4 py-3 align-top">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vì sao nên nâng cấp lúc này?</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Xem lý do nâng cấp dựa trên việc học hiện tại, không chỉ dựa vào bảng giá.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 text-warning-700" />
                <div>
                  <p className="text-sm font-semibold text-warning-800">Lượt dùng sắp là giới hạn chính</p>
                  <p className="mt-1 text-sm leading-6 text-warning-800/90">
                    Gói Miễn phí còn 18 lượt dùng. Một video bài giảng hoặc vài lần tạo lại lời giải có thể dùng hết trong ngày.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
              <div className="flex items-start gap-3">
                <Video className="mt-0.5 h-5 w-5 text-brand-700" />
                <div>
                  <p className="text-sm font-semibold text-brand-800">Học video thuận tiện hơn</p>
                  <p className="mt-1 text-sm leading-6 text-brand-800/90">
                    Student Plus mở đầy đủ điểm dừng trong video và giúp trợ giảng theo sát bản chép lời lâu hơn, phù hợp khi bạn ôn từ bài giảng đã ghi hình.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-success-100 bg-success-50 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 text-success-700" />
                <div>
                  <p className="text-sm font-semibold text-success-800">Theo dõi tiến độ không bị gián đoạn</p>
                  <p className="mt-1 text-sm leading-6 text-success-800/90">
                    Khi không bị chặn bởi giới hạn lượt dùng, tiến độ phản ánh đúng hơn và kế hoạch học không cần cắt bớt việc ôn tập.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upgradeToSelectedPlan}>
                Chọn gói này
                <ArrowRight className="h-4 w-4" />
              </Button>
              <LinkButton href={routes.billing} variant="outline">
                Quay lại gói và mức sử dụng
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
