import Link from "next/link";
import { ArrowRight, BookOpen, Bot, CircleAlert, RotateCcw, Sparkles, Target } from "lucide-react";
import { notFound } from "next/navigation";
import { attempts, documents, getWeakTopic } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { Badge, Card, CardBody, CardHeader, CardTitle, CitationSnippet, LinkButton, ProgressBar, ProgressRing } from "@/components/ui";

function getRelatedDocuments(topicName: string) {
  return documents.filter((documentItem) =>
    documentItem.weakTopics?.includes(topicName),
  );
}

function getTopicEvidence(topicName: string) {
  return attempts.flatMap((attempt) =>
    attempt.topicBreakdown
      .filter((topicBreakdown) => topicBreakdown.topic === topicName)
      .map((topicBreakdown) => ({
        attemptId: attempt.id,
        mode: attempt.mode,
        correct: topicBreakdown.correct,
        total: topicBreakdown.total,
        scorePct: Math.round((topicBreakdown.correct / topicBreakdown.total) * 100),
        documentTitle: attempt.documentTitle,
      })),
  );
}

function getTopicInsight(masteryPct: number): string {
  if (masteryPct < 40) {
    return "Bạn đang nhớ rời rạc các khái niệm chính, nhưng chưa nối chúng thành một cơ chế hoàn chỉnh.";
  }

  if (masteryPct < 55) {
    return "Bạn đã nhận ra thuật ngữ đúng, nhưng vẫn dễ sai ở câu hỏi yêu cầu giải thích hoặc so sánh.";
  }

  return "Đây là vùng đang cải thiện, chỉ cần thêm một vòng review có dẫn chứng để ổn định.";
}

export function WeakTopicDetail({ id }: { readonly id: string }) {
  const weakTopic = getWeakTopic(id);

  if (!weakTopic) {
    notFound();
  }

  const relatedDocuments = getRelatedDocuments(weakTopic.name);
  const topicEvidence = getTopicEvidence(weakTopic.name);
  const nextDocument = relatedDocuments[0];

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <Badge tone={weakTopic.masteryPct < 45 ? "error" : "warning"}>
                Weak topic focus
              </Badge>
              <div>
                <CardTitle className="text-xl">{weakTopic.name}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  {getTopicInsight(weakTopic.masteryPct)} Chủ đề này xuất hiện trong {weakTopic.missedQuestions} câu sai gần đây và đang ảnh hưởng trực tiếp đến readiness cho kỳ thi.
                </p>
              </div>
            </div>
            <ProgressRing
              value={weakTopic.masteryPct}
              tone={weakTopic.masteryPct < 45 ? "warning" : "review"}
              label={`${weakTopic.name} mastery`}
            />
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Mastery</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{weakTopic.masteryPct}%</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Missed questions</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{weakTopic.missedQuestions}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Related documents</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{weakTopic.documentTitles.length}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-800">
              Tín hiệu chính: bạn thường sai ở câu hỏi buộc phải mô tả cơ chế hoặc phân biệt hai khái niệm gần nhau, không phải ở câu hỏi nhớ định nghĩa đơn lẻ.
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suggested actions</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Đi theo đúng thứ tự để sửa lỗi nhanh hơn thay vì học lan man.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            <LinkButton href={routes.studyPlan} className="w-full justify-between">
              Add to today’s plan
              <Sparkles className="h-4 w-4" />
            </LinkButton>
            {nextDocument ? (
              <LinkButton
                href={routes.document(nextDocument.id)}
                variant="secondary"
                className="w-full justify-between"
              >
                Review source section
                <BookOpen className="h-4 w-4" />
              </LinkButton>
            ) : null}
            <LinkButton href={routes.practiceExam("exam_os")} variant="outline" className="w-full justify-between">
              Retry mixed practice
              <RotateCcw className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.tutor} variant="outline" className="w-full justify-between">
              Ask Tutor for simpler explanation
              <Bot className="h-4 w-4" />
            </LinkButton>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Evidence from attempts</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Tổng hợp trực tiếp từ các attempt nơi chủ đề này kéo điểm xuống.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {topicEvidence.length > 0 ? (
              topicEvidence.map((evidence) => (
                <div key={evidence.attemptId} className="rounded-2xl border border-ink-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{evidence.documentTitle}</p>
                      <p className="mt-1 text-sm text-ink-500">Attempt {evidence.attemptId} · {evidence.mode}</p>
                    </div>
                    <Badge tone={evidence.scorePct < 50 ? "error" : "warning"}>
                      {evidence.correct}/{evidence.total} đúng
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-sm text-ink-600">
                      <span>Topic accuracy</span>
                      <span className="font-medium text-ink-900">{evidence.scorePct}%</span>
                    </div>
                    <ProgressBar value={evidence.scorePct} tone={evidence.scorePct < 50 ? "error" : "warning"} />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-ink-200 p-4 text-sm text-ink-500">
                Chưa có attempt breakdown chi tiết cho chủ đề này. Hãy tạo thêm practice exam để có bằng chứng định lượng rõ hơn.
              </div>
            )}
            <p className="text-sm leading-6 text-ink-600">
              Dữ liệu hiện có cho thấy lỗi tập trung ở các câu hỏi cần suy luận cơ chế, không phải câu hỏi nhận biết nhanh. Vì vậy, việc đọc lại source với citation sẽ hiệu quả hơn mở thêm quiz mới ngay lập tức.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Source citations</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Dùng citation để neo lại đúng đoạn kiến thức thay vì ôn cả chương.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {weakTopic.citations.map((citation) => (
              <CitationSnippet key={citation.chunkId} citation={citation} />
            ))}
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
              Khi đọc lại, hãy tự trả lời thành tiếng câu hỏi: “Tại sao cơ chế này cần thiết, và điều gì xảy ra nếu bỏ nó đi?” Cách này giúp chuyển từ nhớ câu chữ sang hiểu bản chất.
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Related documents</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Nơi bạn nên quay lại để sửa lỗi bằng nguồn gốc kiến thức.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            {relatedDocuments.map((documentItem) => (
              <Link
                key={documentItem.id}
                href={routes.document(documentItem.id)}
                className="rounded-2xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{documentItem.title}</p>
                    <p className="mt-1 text-sm text-ink-500">
                      {documentItem.outputs.join(" · ") || "Chưa có output"}
                    </p>
                  </div>
                  {typeof documentItem.masteryPct === "number" ? (
                    <Badge tone={documentItem.masteryPct < 45 ? "error" : "warning"}>
                      {documentItem.masteryPct}%
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700">
                  Open document <ArrowRight className="h-4 w-4" />
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recovery plan</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Một lộ trình ngắn để kéo chủ đề này lên vùng an toàn đầu tiên.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <Target className="h-4 w-4 text-brand-600" />
                Mục tiêu 20 phút
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Đọc lại citation chính, viết lại cơ chế bằng lời của bạn, rồi làm lại nhóm câu sai liên quan. Nếu accuracy lên trên 70% ở lần retry kế tiếp, chủ đề này có thể chuyển về nhóm review duy trì.
              </p>
            </div>
            <div className="rounded-2xl border border-error-100 bg-error-50 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 text-error-700" />
                <div>
                  <p className="text-sm font-semibold text-error-800">Điểm cần tránh</p>
                  <p className="mt-1 text-sm leading-6 text-error-800/90">
                    Đừng chuyển thẳng sang practice exam timed mode nếu bạn vẫn chưa giải thích được citation bằng lời của mình — điều đó thường chỉ lặp lại cùng một kiểu sai.
                  </p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
