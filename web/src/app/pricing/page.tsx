import type { Metadata } from "next";
import { ArrowRight, CircleAlert, CreditCard, FileWarning, Infinity, PlayCircle, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { usage } from "@/lib/mock-data";
import { PublicShell } from "@/components/layout";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  LinkButton,
  ProgressBar,
  SectionHeading,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Bảng giá",
  description:
    "So sánh các plan của LearningPlatform theo credits, uploads, page limits, video minutes, analytics, Tutor access và đường nâng cấp khi chạm giới hạn.",
};

type BillingMode = "monthly" | "yearly";

type PlanDefinition = {
  id: string;
  name: string;
  audience: string;
  tagline: string;
  monthlyPrice: string;
  yearlyMonthlyPrice: string;
  yearlyBilled: string;
  credits: string;
  uploads: string;
  pages: string;
  minutes: string;
  maxFileSize: string;
  videoProcessing: string;
  tutor: string;
  analytics: string;
  overage: string;
  fairUse: string;
  highlighted?: boolean;
  ctaLabel: string;
  ctaHref: string;
};

const planDefinitions: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    audience: "Cho lần thử đầu tiên",
    tagline: "Bắt đầu với PDF/text ngắn, xem quiz grounded hoạt động thế nào trước khi nâng cấp.",
    monthlyPrice: "0₫",
    yearlyMonthlyPrice: "0₫",
    yearlyBilled: "0₫",
    credits: "100 credits / tháng",
    uploads: "10 uploads / tháng",
    pages: "150 trang hoặc tương đương",
    minutes: "0 phút video",
    maxFileSize: "25 MB",
    videoProcessing: "Không",
    tutor: "Theo quota cơ bản",
    analytics: "Tóm tắt yếu/chưa yếu",
    overage: "Không top-up, cần nâng cấp",
    fairUse: "Phù hợp cho thử flow PDF → quiz → review",
    ctaLabel: "Start free",
    ctaHref: routes.signup,
  },
  {
    id: "student-plus",
    name: "Student Plus",
    audience: "Sinh viên ôn từng môn",
    tagline: "Plan cân bằng cho học kỳ thường: đủ credits để làm quiz, flashcards và Tutor hằng ngày.",
    monthlyPrice: "129.000₫",
    yearlyMonthlyPrice: "99.000₫",
    yearlyBilled: "1.188.000₫",
    credits: "500 credits / tháng",
    uploads: "40 uploads / tháng",
    pages: "1.000 trang hoặc tương đương",
    minutes: "90 phút video",
    maxFileSize: "150 MB",
    videoProcessing: "Có",
    tutor: "60 câu hỏi / ngày",
    analytics: "Mastery + weak-topic detail",
    overage: "Mua thêm 200 credits khi cần",
    fairUse: "Phù hợp 2–4 môn, xen kẽ PDF và vài lecture video",
    highlighted: true,
    ctaLabel: "Upgrade to Student Plus",
    ctaHref: routes.upgrade,
  },
  {
    id: "pro-learner",
    name: "Pro Learner",
    audience: "Power learner / exam sprint",
    tagline: "Dành cho người học nhiều tài liệu, cần practice mode, analytics sâu và workload video lớn hơn.",
    monthlyPrice: "249.000₫",
    yearlyMonthlyPrice: "199.000₫",
    yearlyBilled: "2.388.000₫",
    credits: "1.400 credits / tháng",
    uploads: "120 uploads / tháng",
    pages: "3.000 trang hoặc tương đương",
    minutes: "360 phút video",
    maxFileSize: "500 MB",
    videoProcessing: "Có, ưu tiên nhanh hơn",
    tutor: "200 câu hỏi / ngày",
    analytics: "Full analytics + exam readiness",
    overage: "Top-up 500 credits hoặc auto-refill",
    fairUse: "Phù hợp đợt ôn thi cuối kỳ hoặc self-learning nhiều chủ đề",
    ctaLabel: "Go Pro",
    ctaHref: routes.upgrade,
  },
  {
    id: "teacher",
    name: "Teacher / Classroom",
    audience: "Tutor, lớp nhỏ, creator",
    tagline: "Thêm assignment workflow, progress lớp và quota đủ cho nhiều học viên dùng chung một bộ tài liệu.",
    monthlyPrice: "899.000₫",
    yearlyMonthlyPrice: "749.000₫",
    yearlyBilled: "8.988.000₫",
    credits: "6.000 credits / tháng",
    uploads: "Không giới hạn mềm",
    pages: "12.000 trang hoặc tương đương",
    minutes: "1.800 phút video",
    maxFileSize: "1 GB",
    videoProcessing: "Có",
    tutor: "Tutor cho lớp + context theo course",
    analytics: "Class mastery, weak-topic heatmap",
    overage: "Seat + credits add-on",
    fairUse: "Dành cho lớp học thật, có assignment và theo dõi tiến độ",
    ctaLabel: "Talk to sales",
    ctaHref: routes.signup,
  },
  {
    id: "enterprise",
    name: "Enterprise / School",
    audience: "Trường học, tổ chức",
    tagline: "SSO, policy riêng, quota linh hoạt, triển khai theo yêu cầu bảo mật và governance.",
    monthlyPrice: "Custom",
    yearlyMonthlyPrice: "Custom",
    yearlyBilled: "Liên hệ",
    credits: "Theo ngân sách và policy",
    uploads: "Theo workspace",
    pages: "Theo hợp đồng",
    minutes: "Theo hợp đồng",
    maxFileSize: "Theo hạ tầng",
    videoProcessing: "Có",
    tutor: "Quota và policy tùy chỉnh",
    analytics: "Org dashboard + hỗ trợ vận hành",
    overage: "Billing theo hợp đồng",
    fairUse: "Có thể gắn moderation, support và SLA riêng",
    ctaLabel: "Contact enterprise",
    ctaHref: routes.signup,
  },
] as const;

const comparisonRows = [
  { label: "AI credits", key: "credits" },
  { label: "Uploads", key: "uploads" },
  { label: "PDF / text pages", key: "pages" },
  { label: "Video minutes", key: "minutes" },
  { label: "Max file size", key: "maxFileSize" },
  { label: "Video processing", key: "videoProcessing" },
  { label: "Tutor availability", key: "tutor" },
  { label: "Analytics", key: "analytics" },
  { label: "Overage / top-up", key: "overage" },
] as const satisfies readonly { label: string; key: keyof PlanDefinition }[];

const limitStates = [
  {
    title: "Free limit reached",
    reason: "Bạn đã dùng gần hết credits tháng này và không còn quota để xử lý thêm tài liệu lớn.",
    ctaLabel: "Upgrade to Student Plus",
    ctaHref: routes.upgrade,
    alternative: "Hoặc thử sample/demo để xem output trước khi nâng cấp.",
    icon: CreditCard,
    tone: "warning",
  },
  {
    title: "File too large for current plan",
    reason: "Tệp 420 MB vượt quá max file size của Free và Student Plus — upload vẫn bị chặn trước khi trừ credits.",
    ctaLabel: "Compare higher tiers",
    ctaHref: `${routes.pricing}?billing=yearly`,
    alternative: "Hoặc tách file theo chương / lecture để xử lý rẻ hơn.",
    icon: FileWarning,
    tone: "error",
  },
  {
    title: "Video processing requires upgrade",
    reason: "Lecture video chỉ mở trên plan có quota video minutes. Free vẫn cho bạn xem demo nhưng không chạy transcript thật.",
    ctaLabel: "Unlock video processing",
    ctaHref: routes.upgrade,
    alternative: "Hoặc bắt đầu với PDF/text để kiểm tra chất lượng quiz grounded.",
    icon: PlayCircle,
    tone: "brand",
  },
  {
    title: "Tutor daily limit reached",
    reason: "Quota theo ngày giúp giữ tốc độ ổn định và minh bạch chi phí. Bạn vẫn xem được citation từ các answer trước đó.",
    ctaLabel: "Move to Pro Learner",
    ctaHref: routes.upgrade,
    alternative: "Hoặc chuyển sang review flashcards / retry quiz cho đến ngày reset.",
    icon: CircleAlert,
    tone: "warning",
  },
] as const;

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const billingMode = resolveBillingMode(query.billing);
  const creditsUsedPct = Math.round(
    ((usage.creditsTotal - usage.creditsRemaining) / usage.creditsTotal) * 100,
  );
  const uploadsUsedPct = Math.round((usage.uploadsUsed / usage.uploadsLimit) * 100);

  return (
    <PublicShell>
      <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="brand">Pricing & limits</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
              Chọn plan theo workload học tập, không theo những lời hứa mơ hồ về AI.
            </h1>
            <p className="mt-5 text-lg leading-8 text-ink-600">
              Mỗi plan nêu rõ credits, số uploads, page quota, video minutes, max file size, Tutor availability và luật top-up để bạn biết chính xác điều gì sẽ xảy ra trước khi xử lý tài liệu.
            </p>
          </div>

          <div className="mt-8 flex justify-center">
            <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1 card-shadow" aria-label="Billing mode selector">
              <LinkButton
                href={routes.pricing}
                variant={billingMode === "monthly" ? "primary" : "ghost"}
                className="rounded-xl"
              >
                Monthly
              </LinkButton>
              <LinkButton
                href={`${routes.pricing}?billing=yearly`}
                variant={billingMode === "yearly" ? "primary" : "ghost"}
                className="rounded-xl"
              >
                Yearly <span className="ml-1 text-xs text-success-100">save up to 23%</span>
              </LinkButton>
            </div>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader>
                <p className="text-sm font-semibold text-ink-900">Usage transparency trước khi nâng cấp</p>
                <p className="mt-1 text-sm text-ink-500">
                  Người dùng nên thấy rõ mình đang gần giới hạn nào để quyết định upgrade, top-up hay đổi cách học.
                </p>
              </CardHeader>
              <CardBody className="grid gap-5 sm:grid-cols-2">
                <UsageMeter
                  label="Credits used this cycle"
                  value={`${usage.creditsRemaining}/${usage.creditsTotal} còn lại`}
                  helper={`Đã dùng ${creditsUsedPct}% quota · reset ${usage.resetDate}`}
                  progress={creditsUsedPct}
                />
                <UsageMeter
                  label="Uploads used"
                  value={`${usage.uploadsUsed}/${usage.uploadsLimit} uploads`}
                  helper="Free plan hiện tại phù hợp để thử flow, không phù hợp video hoặc bộ tài liệu dài."
                  progress={uploadsUsedPct}
                />
                <div className="rounded-2xl border border-brand-100 bg-brand-50/70 p-4 sm:col-span-2">
                  <p className="text-sm font-semibold text-brand-700">Estimate trước khi xử lý</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <EstimateRow label="PDF 42 trang" value="≈ 14 credits" />
                    <EstimateRow label="Lecture video 25 phút" value="≈ 48 credits" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-ink-700">
                    Credit estimate luôn hiện trước bước process để người học biết chi phí gần đúng của quiz, Tutor index và transcript trước khi bấm xác nhận.
                  </p>
                </div>
              </CardBody>
            </Card>

            <Card className="border-success-100 bg-success-50/70">
              <CardHeader>
                <p className="text-sm font-semibold text-success-700">Billing trust surfaces</p>
                <p className="mt-1 text-sm text-ink-600">
                  Pricing page cần giúp người dùng hiểu giới hạn, không chỉ thúc ép nâng cấp.
                </p>
              </CardHeader>
              <CardBody className="space-y-4 text-sm leading-6 text-ink-700">
                <TrustBullet>Không trừ credits cho upload bị chặn vì sai định dạng hoặc vượt file-size policy.</TrustBullet>
                <TrustBullet>Processing thất bại do output không đủ chất lượng có thể đi kèm hoàn credits, và UI phải nói rõ điều này.</TrustBullet>
                <TrustBullet>Video processing, Tutor quota và analytics depth thay đổi theo plan — không nên giấu sau khi người dùng đã upload xong.</TrustBullet>
                <TrustBullet>Top-up chỉ là lựa chọn bổ sung; nếu plan không hỗ trợ thì CTA phải dẫn sang upgrade flow chứ không hứa hẹn mập mờ.</TrustBullet>
              </CardBody>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Plans"
          title="Một grid để chọn nhanh, một bảng để so sánh chi tiết"
          description="Plan cards giúp người dùng tự nhận diện mình thuộc nhóm nào. Bảng phía dưới giữ toàn bộ comparison về credits, page quota, video, Tutor và analytics trong một chỗ duy nhất."
        />
        <div className="mt-8 grid gap-4 xl:grid-cols-5">
          {planDefinitions.map((plan) => (
            <PlanCard key={plan.id} plan={plan} billingMode={billingMode} />
          ))}
        </div>
      </section>

      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Comparison"
            title="So sánh quota, giới hạn và độ sâu sản phẩm theo từng tier"
            description="Bảng này tránh marketing copy quá mức bằng cách đặt cùng một tập tiêu chí cho mọi plan: AI credits, uploads, PDF pages, video minutes, file size, Tutor, analytics và overage rules."
          />
          <div className="mt-8 overflow-x-auto rounded-3xl border border-ink-200 bg-white card-shadow">
            <table className="min-w-[960px] w-full border-collapse text-left">
              <caption className="sr-only">Bảng so sánh các plan LearningPlatform.</caption>
              <thead className="bg-ink-50/80">
                <tr>
                  <th className="w-56 px-5 py-4 text-sm font-semibold text-ink-900">Plan</th>
                  {planDefinitions.map((plan) => (
                    <th key={plan.id} className="px-5 py-4 text-sm font-semibold text-ink-900">
                      <div className="flex flex-col gap-1">
                        <span>{plan.name}</span>
                        <span className="text-xs font-medium text-ink-500">{getPriceSummary(plan, billingMode)}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.key} className="border-t border-ink-100 align-top">
                    <th className="px-5 py-4 text-sm font-medium text-ink-700">{row.label}</th>
                    {planDefinitions.map((plan) => (
                      <td key={`${plan.id}-${row.key}`} className="px-5 py-4 text-sm leading-6 text-ink-600">
                        {plan[row.key]}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-ink-100 align-top">
                  <th className="px-5 py-4 text-sm font-medium text-ink-700">Fair-use note</th>
                  {planDefinitions.map((plan) => (
                    <td key={`${plan.id}-fairUse`} className="px-5 py-4 text-sm leading-6 text-ink-600">
                      {plan.fairUse}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Limit states"
          title="Khi chạm giới hạn, giao diện phải nói rõ vì sao và lối ra là gì"
          description="Những state này nên xuất hiện trước khi người dùng bị kẹt giữa chừng: limit reason, upgrade/top-up CTA, và alternative action nếu chưa muốn trả tiền ngay."
        />
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {limitStates.map((state) => (
            <LimitStateCard key={state.title} {...state} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="space-y-4">
              <Badge tone="brand">Fair-use & policy</Badge>
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
                Pricing không chỉ là giá — còn là policy về tốc độ, fairness và khả năng dự đoán chi phí.
              </h2>
              <p className="text-base leading-7 text-ink-600">
                LearningPlatform dành cho việc học thật, nên quota phải ưu tiên minh bạch: biết tài liệu nào tốn credits, khi nào video bị chặn, khi nào Tutor hết quota ngày và lúc nào credits được hoàn.
              </p>
            </div>
            <Card>
              <CardBody className="space-y-4">
                <PolicyRow
                  icon={Sparkles}
                  title="You see the estimate first"
                  description="Mọi upload đắt tiền đều hiện estimate về pages/minutes, thời gian xử lý và credits trước khi bắt đầu."
                />
                <PolicyRow
                  icon={Infinity}
                  title="Unlimited never means ungoverned"
                  description="“Không giới hạn mềm” vẫn chịu fair-use policy và moderation để tránh abuse trong lớp học hoặc tổ chức lớn."
                />
                <PolicyRow
                  icon={Users}
                  title="Teacher and school workflows differ"
                  description="Classroom plans thêm assignment, class analytics và billing theo seat/quota thay vì chỉ mở khóa thêm credits cá nhân."
                />
                <div className="flex flex-wrap gap-3 pt-2">
                  <LinkButton href={routes.signup}>
                    Start with Free <ArrowRight className="h-4 w-4" />
                  </LinkButton>
                  <LinkButton href={routes.faq} variant="outline">
                    Đọc FAQ về pricing
                  </LinkButton>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

function resolveBillingMode(value: string | string[] | undefined): BillingMode {
  if (Array.isArray(value)) return resolveBillingMode(value[0]);
  return value === "yearly" ? "yearly" : "monthly";
}

function getPriceSummary(plan: PlanDefinition, billingMode: BillingMode): string {
  if (plan.monthlyPrice === "Custom") {
    return "Liên hệ đội ngũ";
  }

  if (plan.monthlyPrice === "0₫") {
    return "Bắt đầu miễn phí";
  }

  if (billingMode === "monthly") {
    return `${plan.monthlyPrice}/tháng`;
  }

  return `${plan.yearlyMonthlyPrice}/tháng · billed ${plan.yearlyBilled}/năm`;
}

function PlanCard({ plan, billingMode }: { plan: PlanDefinition; billingMode: BillingMode }) {
  const isFree = plan.monthlyPrice === "0₫";
  const isCustom = plan.monthlyPrice === "Custom";
  const displayedPrice = billingMode === "monthly" ? plan.monthlyPrice : plan.yearlyMonthlyPrice;

  return (
    <Card className={cn(plan.highlighted && "border-brand-300 ring-2 ring-brand-100") }>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">{plan.name}</p>
            <p className="mt-1 text-sm text-ink-500">{plan.audience}</p>
          </div>
          {plan.highlighted ? <Badge tone="brand">Popular</Badge> : null}
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-semibold tracking-tight text-ink-900">{displayedPrice}</span>
            <span className="pb-1 text-sm text-ink-500">
              {isFree || isCustom ? "" : "/tháng"}
            </span>
          </div>
          {billingMode === "yearly" && !isFree && !isCustom ? (
            <p className="mt-2 text-sm text-success-700">Thanh toán {plan.yearlyBilled}/năm · tiết kiệm so với trả từng tháng.</p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-ink-600">{plan.tagline}</p>
        </div>

        <div className="space-y-2 rounded-2xl border border-ink-200 bg-ink-50/70 p-4 text-sm text-ink-700">
          <FeatureBullet>{plan.credits}</FeatureBullet>
          <FeatureBullet>{plan.uploads}</FeatureBullet>
          <FeatureBullet>{plan.pages}</FeatureBullet>
          <FeatureBullet>{plan.maxFileSize} max file size</FeatureBullet>
          <FeatureBullet>{plan.videoProcessing}</FeatureBullet>
        </div>

        <div className="space-y-2 text-sm leading-6 text-ink-600">
          <p><span className="font-medium text-ink-900">Tutor:</span> {plan.tutor}</p>
          <p><span className="font-medium text-ink-900">Analytics:</span> {plan.analytics}</p>
          <p><span className="font-medium text-ink-900">Overage:</span> {plan.overage}</p>
          <p><span className="font-medium text-ink-900">Fair use:</span> {plan.fairUse}</p>
        </div>

        <LinkButton href={plan.ctaHref} className="w-full justify-center" variant={plan.highlighted ? "primary" : "outline"}>
          {plan.ctaLabel}
        </LinkButton>
      </CardBody>
    </Card>
  );
}

function LimitStateCard({
  title,
  reason,
  ctaLabel,
  ctaHref,
  alternative,
  icon: Icon,
  tone,
}: {
  title: string;
  reason: string;
  ctaLabel: string;
  ctaHref: string;
  alternative: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "brand" | "warning" | "error";
}) {
  const toneMap = {
    brand: "bg-brand-50 text-brand-700 border-brand-100",
    warning: "bg-warning-50 text-warning-700 border-warning-100",
    error: "bg-error-50 text-error-700 border-error-100",
  } as const;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border", toneMap[tone])}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">{reason}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
          {alternative}
        </div>
        <div className="flex flex-wrap gap-3">
          <LinkButton href={ctaHref}>{ctaLabel}</LinkButton>
          <LinkButton href={routes.examples} variant="outline">
            Xem example trước
          </LinkButton>
        </div>
      </CardBody>
    </Card>
  );
}

function UsageMeter({
  label,
  value,
  helper,
  progress,
}: {
  label: string;
  value: string;
  helper: string;
  progress: number;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-ink-200 bg-white p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
        <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
      </div>
      <ProgressBar value={progress} tone={progress >= 80 ? "warning" : "brand"} />
      <p className="text-sm leading-6 text-ink-500">{helper}</p>
    </div>
  );
}

function EstimateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white bg-white px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-ink-900">{value}</p>
    </div>
  );
}

function FeatureBullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function TrustBullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function PolicyRow({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-600">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="mt-1 text-sm leading-6 text-ink-600">{description}</p>
      </div>
    </div>
  );
}
