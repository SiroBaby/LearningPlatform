import { CreditCard, FileWarning, Gauge, Receipt, Sparkles, TriangleAlert, Video } from "lucide-react";
import { documents, formatDate, invoices, jobs, usage } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LinkButton, ProgressBar, ProgressRing } from "@/components/ui";

interface LimitState {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly tone: "warning" | "error" | "brand";
}

interface CostRow {
  readonly documentTitle: string;
  readonly estimate: string;
  readonly output: string;
  readonly status: string;
}

interface PaymentMethod {
  readonly brand: string;
  readonly last4: string;
  readonly expiry: string;
  readonly isDefault: boolean;
}

const limitStates: readonly LimitState[] = [
  {
    title: "Credits còn thấp",
    description: `Bạn còn ${usage.creditsRemaining}/${usage.creditsTotal} credits. Một video dài hoặc nhiều lần regenerate có thể chạm trần ngay trong hôm nay.`,
    actionLabel: "Upgrade plan",
    tone: "warning",
  },
  {
    title: "Video processing cần gói cao hơn",
    description: "Gói hiện tại chỉ phù hợp để thử nghiệm tài liệu ngắn. Nếu muốn xử lý video dài ổn định, bạn nên chuyển sang Student Plus hoặc Pro Learner.",
    actionLabel: "Compare plans",
    tone: "brand",
  },
  {
    title: "File lớn có thể bị chặn",
    description: "Tài liệu nhiều trang hoặc audio dài sẽ bị giới hạn theo plan và số credits còn lại trước khi pipeline bắt đầu.",
    actionLabel: "See upload estimate",
    tone: "error",
  },
] as const;

const costRows: readonly CostRow[] = [
  {
    documentTitle: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
    estimate: "12 credits",
    output: "Quiz · Flashcards · Tutor",
    status: "Ready",
  },
  {
    documentTitle: "Machine Learning Foundations — Optimization.pdf",
    estimate: "10 credits",
    output: "Quiz · Flashcards · Tutor",
    status: "Ready",
  },
  {
    documentTitle: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
    estimate: "38 credits",
    output: "Checkpoints · Tutor · Quiz",
    status: "Ready",
  },
  {
    documentTitle: "Cơ sở dữ liệu — Chương 5: Chuẩn hóa quan hệ.pdf",
    estimate: jobs[0].costEstimate,
    output: "Quiz đang tạo",
    status: "Processing",
  },
] as const;

const paymentMethods: readonly PaymentMethod[] = [
  {
    brand: "Visa",
    last4: "4242",
    expiry: "08/27",
    isDefault: true,
  },
] as const;

function getUploadsUsagePct(): number {
  return Math.round((usage.uploadsUsed / usage.uploadsLimit) * 100);
}

function getCreditsUsagePct(): number {
  return Math.round(((usage.creditsTotal - usage.creditsRemaining) / usage.creditsTotal) * 100);
}

function getToneClass(tone: LimitState["tone"]): string {
  return {
    brand: "border-brand-100 bg-brand-50 text-brand-700",
    warning: "border-warning-100 bg-warning-50 text-warning-800",
    error: "border-error-100 bg-error-50 text-error-800",
  }[tone];
}

export function BillingOverview() {
  const uploadsUsagePct = getUploadsUsagePct();
  const creditsUsagePct = getCreditsUsagePct();
  const processingJobs = documents.filter((documentItem) => documentItem.status === "processing");

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <CreditCard className="h-4 w-4 text-brand-600" />
              Current plan
            </div>
            <div>
              <p className="text-3xl font-semibold tracking-tight text-ink-900">{usage.planLabel}</p>
              <p className="mt-1 text-sm text-ink-600">Reset ngày {formatDate(usage.resetDate)}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Gauge className="h-4 w-4 text-mastery-600" />
              Credits remaining
            </div>
            <div>
              <p className="text-3xl font-semibold tracking-tight text-ink-900">{usage.creditsRemaining}</p>
              <p className="mt-1 text-sm text-ink-600">trên tổng {usage.creditsTotal} credits tháng này</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Receipt className="h-4 w-4 text-review-600" />
              Upload usage
            </div>
            <div>
              <p className="text-3xl font-semibold tracking-tight text-ink-900">{usage.uploadsUsed}/{usage.uploadsLimit}</p>
              <p className="mt-1 text-sm text-ink-600">tài liệu đã dùng trong chu kỳ hiện tại</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
                <Sparkles className="h-4 w-4 text-brand-600" />
                Upgrade path
              </div>
              <p className="text-sm leading-6 text-ink-600">
                Chuyển sang plan cao hơn để mở video processing, tăng credit trần và giữ analytics liên tục.
              </p>
            </div>
            <ProgressRing value={100 - creditsUsagePct} tone="brand" label="Credits left" />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Usage health</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Giải thích rõ thứ gì đang tiêu tốn credits và giới hạn nào có thể chặn phiên học tiếp theo.
              </p>
            </div>
            <LinkButton href={routes.upgrade} size="sm">
              Upgrade plan
            </LinkButton>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="space-y-3 rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink-700">Credits used</span>
                <span className="text-ink-900">{usage.creditsTotal - usage.creditsRemaining}/{usage.creditsTotal}</span>
              </div>
              <ProgressBar value={creditsUsagePct} tone={creditsUsagePct > 80 ? "warning" : "brand"} />
              <p className="text-sm leading-6 text-ink-600">
                Video và regenerate là hai thao tác đốt credit nhanh nhất. Trạng thái hiện tại vẫn đủ cho một vài phiên quiz ngắn nhưng không còn dư cho nhiều lần xử lý mới.
              </p>
            </div>
            <div className="space-y-3 rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink-700">Uploads this cycle</span>
                <span className="text-ink-900">{usage.uploadsUsed}/{usage.uploadsLimit}</span>
              </div>
              <ProgressBar value={uploadsUsagePct} tone={uploadsUsagePct > 80 ? "warning" : "success"} />
              <p className="text-sm leading-6 text-ink-600">
                Bạn đã dùng 60% quota upload. Nếu muốn thêm tài liệu ôn thi mới trong tuần này, nên nâng plan trước để tránh bị ngắt quãng giữa kỳ.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Video className="h-4 w-4 text-brand-600" />
                  Video processing
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Dành cho bài giảng dài, tạo checkpoint và transcript. Free plan chỉ nên dùng cho sample ngắn.
                </p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <FileWarning className="h-4 w-4 text-warning-700" />
                  Before processing
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Upload flow luôn nên hiển thị credit estimate, thời gian dự kiến và cảnh báo khi file vượt plan.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active limit states</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Lý do cụ thể và hành động thay thế để người học không bị chặn mơ hồ.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            {limitStates.map((state) => (
              <div key={state.title} className={`rounded-2xl border p-4 ${getToneClass(state.tone)}`}>
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 h-5 w-5" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{state.title}</p>
                    <p className="text-sm leading-6 opacity-90">{state.description}</p>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton href={routes.upgrade} size="sm" variant={state.tone === "error" ? "danger" : "secondary"}>
                        {state.actionLabel}
                      </LinkButton>
                      <LinkButton href={routes.upload} size="sm" variant="outline">
                        Review upload flow
                      </LinkButton>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Processing history & cost estimate</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Từng tài liệu nên giải thích rõ output nào tiêu tốn credits và đang ở trạng thái gì.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            {costRows.map((row) => (
              <div key={row.documentTitle} className="rounded-2xl border border-ink-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{row.documentTitle}</p>
                    <p className="mt-1 text-sm text-ink-500">{row.output}</p>
                  </div>
                  <div className="text-right">
                    <Badge tone={row.status === "Processing" ? "brand" : "neutral"}>{row.status}</Badge>
                    <p className="mt-2 text-sm font-medium text-ink-900">{row.estimate}</p>
                  </div>
                </div>
              </div>
            ))}
            {processingJobs.length > 0 ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 text-sm leading-6 text-brand-700">
                Hiện có {processingJobs.length} job đang chạy. Người học cần thấy rõ rằng họ có thể rời trang upload và quay lại sau khi pipeline hoàn tất.
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription management</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Trạng thái thanh toán, hóa đơn và phương thức trả tiền cần minh bạch ngay cả với mock UI.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="space-y-3">
              {paymentMethods.map((method) => (
                <div key={`${method.brand}-${method.last4}`} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{method.brand} •••• {method.last4}</p>
                      <p className="mt-1 text-sm text-ink-500">Expires {method.expiry}</p>
                    </div>
                    {method.isDefault ? <Badge tone="success">Default</Badge> : null}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline">Update payment method</Button>
                <Button variant="outline">Cancel subscription</Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink-900">Invoices</p>
                <Badge tone="neutral">{invoices.length} invoice</Badge>
              </div>
              {invoices.map((invoice) => (
                <div key={invoice.id} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{invoice.planLabel}</p>
                      <p className="mt-1 text-sm text-ink-500">Issued {formatDate(invoice.date)}</p>
                    </div>
                    <div className="text-right">
                      <Badge tone={invoice.status === "paid" ? "success" : invoice.status === "failed" ? "error" : "warning"}>
                        {invoice.status}
                      </Badge>
                      <p className="mt-2 text-sm font-medium text-ink-900">{invoice.amount}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-ink-100 p-4 text-sm leading-6 text-ink-600">
              Renewal window sẽ đến trước ngày {formatDate(usage.resetDate)}. Nếu bạn nâng plan ngay bây giờ, phần quota mới nên được giải thích rõ là áp dụng tức thì hay từ chu kỳ kế tiếp.
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-5 card-shadow">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Next recommended billing action</h2>
            <p className="mt-1 text-sm text-ink-600">
              Vì bạn sắp hết credits và đang chuẩn bị thi, lựa chọn hợp lý nhất là nâng lên Student Plus để giữ dòng học liên tục mà chưa phải trả cho toàn bộ bundle Pro.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={routes.upgrade}>Compare upgrade options</LinkButton>
            <LinkButton href={routes.analytics} variant="outline">
              Back to analytics
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
