import { Card, CardBody, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

export function AuthShell({
  title,
  description,
  children,
  layout = "default",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  layout?: "default" | "wide";
}) {
  const isWideLayout = layout === "wide";

  return (
    <div
      className={cn(
        "grid min-h-screen bg-ink-50",
        isWideLayout
          ? "lg:grid-cols-[minmax(0,720px)_1fr] xl:grid-cols-[minmax(0,900px)_1fr]"
          : "lg:grid-cols-[minmax(0,520px)_1fr]",
      )}
    >
      <div className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className={cn("w-full space-y-6", isWideLayout ? "max-w-5xl" : "max-w-md")}>
          <div>
            <p className="text-sm font-semibold text-brand-600">LearningPlatform</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
          </div>
          <Card>
            <CardBody>{children}</CardBody>
          </Card>
        </div>
      </div>

      <aside className="hidden border-l border-ink-200 bg-white px-10 py-12 lg:block">
        <div className="mx-auto flex h-full max-w-2xl flex-col justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-600">
              Học tập có căn cứ nguồn
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-ink-900">
              Từ tài liệu thô đến trải nghiệm học chủ động.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink-600">
              Tải lên PDF hoặc video bài giảng. Hệ thống tạo bài kiểm tra, điểm dừng, thẻ ghi nhớ và lời giải có trích dẫn nguồn để bạn kiểm tra mức độ hiểu bài.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardBody className="space-y-3">
                <CardTitle>Bài kiểm tra có căn cứ nguồn</CardTitle>
                <p className="text-sm text-ink-600">
                  Mỗi lời giải đều nhảy về trang hoặc timestamp gốc để bạn tự kiểm chứng.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <CardTitle>Ưu tiên điểm yếu</CardTitle>
                <p className="text-sm text-ink-600">
                  Danh sách ôn tập gom các câu sai, thẻ ghi nhớ đến hạn và phần video bạn hay bỏ lỡ.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </aside>
    </div>
  );
}
