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
    title: "Lượt dùng còn thấp",
    description: `Bạn còn ${usage.creditsRemaining}/${usage.creditsTotal} lượt dùng. Một video dài hoặc nhiều lần tạo lại có thể chạm trần ngay trong hôm nay.`,
    actionLabel: "Nâng cấp gói",
    tone: "warning",
  },
  {
    title: "Xử lý video cần gói cao hơn",
    description: "Gói hiện tại chỉ phù hợp để thử nghiệm tài liệu ngắn. Nếu muốn xử lý video dài ổn định, bạn nên chuyển sang Student Plus hoặc Pro Learner.",
    actionLabel: "So sánh các gói",
    tone: "brand",
  },
  {
    title: "Tệp lớn có thể bị chặn",
    description: "Tài liệu nhiều trang hoặc audio dài sẽ bị giới hạn theo gói và số lượt dùng còn lại trước khi bắt đầu xử lý.",
    actionLabel: "Xem ước tính tải lên",
    tone: "error",
  },
] as const;

const costRows: readonly CostRow[] = [
  {
    documentTitle: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
    estimate: "12 lượt dùng",
    output: "Bài kiểm tra · Thẻ ghi nhớ · Trợ giảng",
    status: "Sẵn sàng",
  },
  {
    documentTitle: "Machine Learning Foundations — Optimization.pdf",
    estimate: "10 lượt dùng",
    output: "Bài kiểm tra · Thẻ ghi nhớ · Trợ giảng",
    status: "Sẵn sàng",
  },
  {
    documentTitle: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
    estimate: "38 lượt dùng",
    output: "Điểm dừng · Trợ giảng · Bài kiểm tra",
    status: "Sẵn sàng",
  },
  {
    documentTitle: "Cơ sở dữ liệu — Chương 5: Chuẩn hóa quan hệ.pdf",
    estimate: jobs[0].costEstimate,
    output: "Bài kiểm tra đang tạo",
    status: "Đang xử lý",
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
  const planLabel = usage.planLabel === "Free" ? "Miễn phí" : usage.planLabel;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <CreditCard className="h-4 w-4 text-brand-600" />
              Gói hiện tại
            </div>
            <div>
              <p className="text-3xl font-semibold tracking-tight text-ink-900">{planLabel}</p>
              <p className="mt-1 text-sm text-ink-600">Đặt lại vào {formatDate(usage.resetDate)}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Gauge className="h-4 w-4 text-mastery-600" />
              Lượt dùng còn lại
            </div>
            <div>
              <p className="text-3xl font-semibold tracking-tight text-ink-900">{usage.creditsRemaining}</p>
              <p className="mt-1 text-sm text-ink-600">trên tổng {usage.creditsTotal} lượt dùng tháng này</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Receipt className="h-4 w-4 text-review-600" />
              Mức sử dụng tải lên
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
                Hướng nâng cấp
              </div>
              <p className="text-sm leading-6 text-ink-600">
                Chuyển sang gói cao hơn để mở xử lý video, tăng số lượt dùng và theo dõi tiến độ liên tục.
              </p>
            </div>
            <ProgressRing value={100 - creditsUsagePct} tone="brand" label="Lượt dùng còn lại" />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Tình trạng sử dụng</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Xem điều gì đang dùng nhiều lượt và giới hạn nào có thể ảnh hưởng đến phiên học tiếp theo.
              </p>
            </div>
            <LinkButton href={routes.upgrade} size="sm">
              Nâng cấp gói
            </LinkButton>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="space-y-3 rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink-700">Lượt dùng đã sử dụng</span>
                <span className="text-ink-900">{usage.creditsTotal - usage.creditsRemaining}/{usage.creditsTotal}</span>
              </div>
              <ProgressBar value={creditsUsagePct} tone={creditsUsagePct > 80 ? "warning" : "brand"} />
              <p className="text-sm leading-6 text-ink-600">
                Video và tạo lại nội dung dùng lượt nhanh nhất. Số lượt hiện tại vẫn đủ cho vài lần luyện ngắn, nhưng có thể không đủ cho nhiều tài liệu mới.
              </p>
            </div>
            <div className="space-y-3 rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink-700">Lượt tải lên trong chu kỳ</span>
                <span className="text-ink-900">{usage.uploadsUsed}/{usage.uploadsLimit}</span>
              </div>
              <ProgressBar value={uploadsUsagePct} tone={uploadsUsagePct > 80 ? "warning" : "success"} />
              <p className="text-sm leading-6 text-ink-600">
                Bạn đã dùng {uploadsUsagePct}% giới hạn tải lên. Nếu muốn thêm tài liệu ôn thi trong tuần này, hãy nâng gói trước để tránh bị gián đoạn.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Video className="h-4 w-4 text-brand-600" />
                  Xử lý video
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Dành cho bài giảng dài, tạo điểm dừng và bản chép lời. Gói Miễn phí phù hợp với tài liệu ngắn.
                </p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <FileWarning className="h-4 w-4 text-warning-700" />
                  Trước khi xử lý
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Luồng tải lên luôn hiển thị ước tính lượt dùng, thời gian dự kiến và cảnh báo khi tệp vượt giới hạn gói.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Giới hạn đang áp dụng</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Xem lý do và chọn việc cần làm tiếp theo khi bạn gặp giới hạn.
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
                        Xem cách tải lên
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
            <CardTitle>Lịch sử tạo nội dung và lượt dùng ước tính</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Mỗi tài liệu cho biết nội dung đã tạo, số lượt dùng ước tính và trạng thái hiện tại.
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
                    <Badge tone={row.status === "Đang xử lý" ? "brand" : "neutral"}>{row.status}</Badge>
                    <p className="mt-2 text-sm font-medium text-ink-900">{row.estimate}</p>
                  </div>
                </div>
              </div>
            ))}
            {processingJobs.length > 0 ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 text-sm leading-6 text-brand-700">
                Hiện có {processingJobs.length} tài liệu đang được xử lý. Bạn có thể rời trang này và quay lại sau.
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quản lý gói đăng ký</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Xem hóa đơn và phương thức thanh toán của bạn.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="space-y-3">
              {paymentMethods.map((method) => (
                <div key={`${method.brand}-${method.last4}`} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{method.brand} •••• {method.last4}</p>
                      <p className="mt-1 text-sm text-ink-500">Hết hạn {method.expiry}</p>
                    </div>
                    {method.isDefault ? <Badge tone="success">Mặc định</Badge> : null}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline">Cập nhật phương thức thanh toán</Button>
                <Button variant="outline">Hủy gói đăng ký</Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink-900">Hóa đơn</p>
                <Badge tone="neutral">{invoices.length} hóa đơn</Badge>
              </div>
              {invoices.map((invoice) => (
                <div key={invoice.id} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{invoice.planLabel}</p>
                      <p className="mt-1 text-sm text-ink-500">Phát hành ngày {formatDate(invoice.date)}</p>
                    </div>
                    <div className="text-right">
                      <Badge tone={invoice.status === "paid" ? "success" : invoice.status === "failed" ? "error" : "warning"}>
                        {invoice.status === "paid" ? "Đã thanh toán" : invoice.status === "failed" ? "Thất bại" : "Đang chờ"}
                      </Badge>
                      <p className="mt-2 text-sm font-medium text-ink-900">{invoice.amount}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-ink-100 p-4 text-sm leading-6 text-ink-600">
              Chu kỳ hiện tại sẽ đặt lại trước ngày {formatDate(usage.resetDate)}. Nếu nâng gói ngay bây giờ, giới hạn mới sẽ áp dụng theo điều kiện của gói.
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-5 card-shadow">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Việc nên làm tiếp theo</h2>
            <p className="mt-1 text-sm text-ink-600">
              Vì bạn sắp hết lượt dùng và đang chuẩn bị thi, lựa chọn hợp lý nhất là nâng lên Student Plus để giữ việc học liên tục.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={routes.upgrade}>So sánh lựa chọn nâng cấp</LinkButton>
            <LinkButton href={routes.analytics} variant="outline">
              Về trang tiến độ
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
