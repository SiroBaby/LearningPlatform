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
    name: "Free",
    monthlyPrice: "0₫",
    yearlyPrice: "0₫",
    credits: "100 / tháng",
    uploads: "10 tài liệu / tháng",
    maxFile: "Tài liệu ngắn",
    tutor: "Giới hạn mỗi ngày",
    analytics: "Cơ bản",
    video: "Sample ngắn",
    features: [
      "Phù hợp để thử luồng upload → quiz → result",
      "Cảnh báo rõ khi chạm credit hoặc file size limit",
      "Không phù hợp cho video dài hoặc regenerate nhiều lần",
    ],
  },
  {
    id: "student-plus",
    name: "Student Plus",
    monthlyPrice: "129.000₫",
    yearlyPrice: "1.290.000₫",
    credits: "450 / tháng",
    uploads: "50 tài liệu / tháng",
    maxFile: "PDF/audio/video vừa",
    tutor: "Không giới hạn theo ngày",
    analytics: "Đầy đủ learner analytics",
    video: "Checkpoint + transcript",
    highlight: true,
    features: [
      "Tăng credit đủ cho giai đoạn ôn thi cường độ cao",
      "Mở video checkpoint và exam prep đầy đủ",
      "Phù hợp nhất cho sinh viên có nhiều tài liệu theo course",
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
    analytics: "Advanced trends + exam planning",
    video: "Batch processing",
    features: [
      "Dành cho power learner ôn nhiều môn cùng lúc",
      "Thêm headroom cho regenerate, tutor sâu và đề thi thử lặp lại",
      "Tối ưu hơn nếu bạn dùng sản phẩm hằng ngày",
    ],
  },
] as const;

const featureRows = [
  {
    label: "AI credits",
    values: ["100 / tháng", "450 / tháng", "1.000 / tháng"],
  },
  {
    label: "Uploads / pages / minutes",
    values: ["10 tài liệu · giới hạn nhỏ", "50 tài liệu · mức vừa", "Fair use mềm · mức cao"],
  },
  {
    label: "Video processing",
    values: ["Sample ngắn", "Có", "Có + batch"],
  },
  {
    label: "Tutor availability",
    values: ["Giới hạn ngày", "Không giới hạn", "Không giới hạn + ưu tiên"],
  },
  {
    label: "Analytics",
    values: ["Cơ bản", "Đầy đủ learner view", "Advanced planning"],
  },
  {
    label: "Overage / top-up",
    values: ["Nâng cấp khi chạm trần", "Top-up hoặc upgrade", "Top-up linh hoạt"],
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

    notify(`Đã chọn mock upgrade sang ${plan.name}. Luồng thanh toán thật chưa được nối backend.`, "success");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-5 card-shadow">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">Recommended upgrade</Badge>
              <Badge tone="warning">Current plan: {usage.planLabel}</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900">
              Upgrade before your next heavy study session
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600">
              Bạn đang ở giai đoạn chuẩn bị thi, credits còn thấp và có ít nhất một video lecture trong course hiện tại. Student Plus là điểm cân bằng tốt nhất giữa chi phí và headroom cho quiz, tutor, analytics và checkpoint.
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
              Monthly
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
              Yearly
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
                      {plan.highlight ? <Badge tone="brand">Best for exam prep</Badge> : null}
                    </div>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{price}</p>
                    <p className="mt-1 text-sm text-ink-500">{billingCycle === "yearly" ? "Tính theo năm" : "Tính theo tháng"}</p>
                  </div>
                  {plan.id === usage.planTier ? <Badge tone="warning">Current</Badge> : null}
                </div>
                <div className="space-y-2 text-sm text-ink-600">
                  <p><span className="font-medium text-ink-900">Credits:</span> {plan.credits}</p>
                  <p><span className="font-medium text-ink-900">Uploads:</span> {plan.uploads}</p>
                  <p><span className="font-medium text-ink-900">Max file:</span> {plan.maxFile}</p>
                  <p><span className="font-medium text-ink-900">Tutor:</span> {plan.tutor}</p>
                  <p><span className="font-medium text-ink-900">Analytics:</span> {plan.analytics}</p>
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
                  {isSelected ? "Selected" : "Choose this plan"}
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Plan comparison</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Minh bạch về quota, tính năng và đường nâng cấp khi learner chạm giới hạn.
            </p>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-ink-600">
              <thead>
                <tr className="border-b border-ink-100 text-ink-900">
                  <th className="py-3 pr-4 font-semibold">Feature</th>
                  <th className="px-4 py-3 font-semibold">Free</th>
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
            <CardTitle>Why upgrade now</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Kết nối lý do nâng cấp với workflow học tập thực tế, không chỉ với bảng giá.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 text-warning-700" />
                <div>
                  <p className="text-sm font-semibold text-warning-800">Credits are the immediate bottleneck</p>
                  <p className="mt-1 text-sm leading-6 text-warning-800/90">
                    Free plan còn 18 credits. Chỉ một video lecture hoặc vài lần regenerate explanation có thể tiêu hết phần còn lại ngay trong ngày.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
              <div className="flex items-start gap-3">
                <Video className="mt-0.5 h-5 w-5 text-brand-700" />
                <div>
                  <p className="text-sm font-semibold text-brand-800">Video checkpoint becomes usable</p>
                  <p className="mt-1 text-sm leading-6 text-brand-800/90">
                    Student Plus mở checkpoint đầy đủ cho video và giúp tutor giữ ngữ cảnh transcript lâu hơn — rất hợp khi ôn từ bài giảng recorded.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-success-100 bg-success-50 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 text-success-700" />
                <div>
                  <p className="text-sm font-semibold text-success-800">Analytics and study plan stay continuous</p>
                  <p className="mt-1 text-sm leading-6 text-success-800/90">
                    Khi không bị ngắt bởi quota, analytics sẽ phản ánh đúng tiến bộ hơn và study plan không phải cắt bớt task chỉ vì credit limit.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upgradeToSelectedPlan}>
                Upgrade to selected plan
                <ArrowRight className="h-4 w-4" />
              </Button>
              <LinkButton href={routes.billing} variant="outline">
                Back to billing
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
