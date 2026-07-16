import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { Badge, Card, CardBody, CardHeader, CardTitle, ProgressBar } from "@/components/ui";
import type { Phase0CitationLocator } from "@/lib/phase0/contracts";
import { getPhase0AttemptResultServer, Phase0ServerError } from "@/lib/phase0/server-data";

interface QuizResultPageProps {
  params: Promise<{ id: string; attemptId: string }>;
}

async function loadAttemptResultOr404(quizId: string, attemptId: string) {
  try {
    return await getPhase0AttemptResultServer(quizId, attemptId);
  } catch (error) {
    if (error instanceof Phase0ServerError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

function toPercent(score: number, questionCount: number): number {
  return questionCount === 0 ? 0 : Math.round((score / questionCount) * 100);
}

function formatCitationLocator(locator: Phase0CitationLocator): string {
  switch (locator.kind) {
    case "page":
      return `Trang ${locator.page}`;
    case "text-range":
      return "Đoạn văn liên quan";
    case "time":
      return `Giây ${locator.startSec}-${locator.endSec}`;
  }
}

export function generateMetadata(): Metadata {
  return {
    title: "Kết quả quiz",
    description: "Xem điểm số, câu trả lời đúng sai và giải thích cho từng câu.",
  };
}

export default async function QuizResultPage({ params }: QuizResultPageProps) {
  const { id, attemptId } = await params;
  const attempt = await loadAttemptResultOr404(id, attemptId);
  const scorePct = toPercent(attempt.score, attempt.questionCount);
  const correctCount = attempt.results.filter((item) => item.isCorrect).length;
  const resultTone = scorePct >= 70 ? "success" : "warning";

  return (
    <LearnerShell
      title="Kết quả quiz"
      subtitle="Xem điểm số, câu nào đúng sai và đọc lại giải thích bất cứ lúc nào."
    >
      <div className="space-y-6">
        <Card>
          <CardBody className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_320px]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={resultTone}>{scorePct}%</Badge>
                <Badge>{correctCount}/{attempt.questionCount} câu đúng</Badge>
                <Badge>{new Date(attempt.submittedAt).toLocaleString("vi-VN")}</Badge>
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Kết quả của bạn: {scorePct}%</h2>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Xem lại đáp án đã chọn, đáp án đúng, phần giải thích và trích dẫn cho từng câu bên dưới.
                </p>
              </div>
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm text-ink-600">
                      <span>Điểm</span>

                    <span>{scorePct}%</span>
                  </div>
                  <ProgressBar value={scorePct} tone={resultTone} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-800">
                      Đúng: {correctCount}

                  </div>
                  <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-700">
                      Sai: {attempt.questionCount - correctCount}

                  </div>
                </div>
              </div>
            </div>
            <Card className="border-ink-100 bg-ink-50/60">
              <CardHeader>
                <CardTitle>Tiếp theo</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm text-ink-600">
                <div className="rounded-2xl border border-ink-100 bg-white px-4 py-3">Bạn có thể xem lại từng câu ngay bên dưới.</div>
                <div className="rounded-2xl border border-ink-100 bg-white px-4 py-3">Hãy ghi chú lại những câu bạn còn nhầm để ôn lại sau.</div>
                <div className="rounded-2xl border border-ink-100 bg-white px-4 py-3">Khi sẵn sàng, bạn có thể quay lại thư viện để mở tài liệu hoặc làm quiz khác.</div>
              </CardBody>
            </Card>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Xem lại từng câu</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {attempt.results.map((item) => (
              <div key={item.questionId} className="rounded-2xl border border-ink-100 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.isCorrect ? "success" : "error"}>{item.isCorrect ? "Đúng" : "Sai"}</Badge>
                  <Badge>Câu {item.ordinal + 1}</Badge>
                </div>
                <p className="mt-3 text-sm font-semibold text-ink-900">{item.stem}</p>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="rounded-xl border border-ink-100 bg-ink-50 px-3 py-2">
                    Câu trả lời của bạn: {item.selectedOptionContent}
                  </div>
                  <div className="rounded-xl border border-success-100 bg-success-50 px-3 py-2 text-success-800">
                    Đáp án đúng: {item.correctOptionContent}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink-600">{item.explanation}</p>
                <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
                  <p className="text-xs font-semibold text-brand-700">
                    Trích dẫn nguồn · {formatCitationLocator(item.citation.locator)}
                  </p>
                  <p className="mt-1.5 text-sm italic leading-relaxed text-ink-700">
                    “{item.citation.snippet}”
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </LearnerShell>
  );
}
