import { Card, CardBody, CardTitle } from "@/components/ui";

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-ink-50 lg:grid-cols-[minmax(0,520px)_1fr]">
      <div className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-md space-y-6">
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
              Source-grounded learning
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-ink-900">
              Từ tài liệu thô đến trải nghiệm học chủ động.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink-600">
              Upload PDF hoặc video bài giảng. Hệ thống sinh quiz, checkpoint, flashcard và giải thích có trích dẫn nguồn để bạn kiểm tra hiểu thật, không học thụ động.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardBody className="space-y-3">
                <CardTitle>Quiz có căn cứ nguồn</CardTitle>
                <p className="text-sm text-ink-600">
                  Mỗi lời giải đều nhảy về trang hoặc timestamp gốc để bạn tự kiểm chứng.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <CardTitle>Ưu tiên điểm yếu</CardTitle>
                <p className="text-sm text-ink-600">
                  Review queue gom các câu sai, flashcard đến hạn và phần video bạn hay bỏ lỡ.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </aside>
    </div>
  );
}
