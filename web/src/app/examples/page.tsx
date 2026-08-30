import type { Metadata } from "next";
import { ArrowRight, CirclePlay, ClipboardCheck, FileQuestion, Layers3 } from "lucide-react";
import type { Citation } from "@/lib/types";
import { citations, decks, videoCheckpoints } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { PublicShell } from "@/components/layout";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationSnippet,
  LinkButton,
  SectionHeading,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Ví dụ",
  description:
    "Xem gallery output mẫu của LearningPlatform: source excerpt, generated question, explanation, citation và result state trước khi tạo tài khoản.",
};

type ExampleTone = "brand" | "success" | "warning" | "mastery" | "review";

type ExampleItem = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  sourceLabel: string;
  sourceExcerpt: string;
  generatedLabel: string;
  generatedPrompt: string;
  explanation: string;
  citation: Citation;
  resultLabel: string;
  resultValue: string;
  resultDetail: string;
  tone: ExampleTone;
};

const exampleItems: readonly ExampleItem[] = [
  {
    id: "vi-pdf-quiz",
    eyebrow: "Vietnamese lecture PDF → Quiz",
    title: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
    description:
      "Phù hợp với workflow ôn thi cuối kỳ: tài liệu dài, nhiều khái niệm dễ tưởng là đã hiểu nhưng khi tự trả lời lại lẫn lộn.",
    icon: FileQuestion,
    sourceLabel: "Source excerpt · Trang 12",
    sourceExcerpt:
      "Context switch requires saving and restoring process state, which introduces CPU overhead because no useful work is done during the switch.",
    generatedLabel: "Generated question",
    generatedPrompt: "Vì sao context switching tạo overhead cho hệ thống?",
    explanation:
      "Hệ thống biến phần lý thuyết này thành câu hỏi active recall, sau đó explanation giải thích lại bằng ngôn ngữ gần với bài giảng thay vì chỉ nêu đáp án đúng.",
    citation: citations.osContextSwitch,
    resultLabel: "Result state",
    resultValue: "72% sau lần làm đầu tiên",
    resultDetail: "Câu sai được gắn vào weak-topic Đồng bộ tiến trình và đưa sang review queue.",
    tone: "brand",
  },
  {
    id: "en-article-flashcards",
    eyebrow: "English technical article → Flashcards",
    title: "Machine Learning Foundations — Optimization.pdf",
    description:
      "Dành cho tài liệu tiếng Anh kỹ thuật, nơi người học cần vừa giữ thuật ngữ gốc vừa hiểu bản chất bằng giải thích ngắn gọn.",
    icon: Layers3,
    sourceLabel: "Source excerpt · Page 7",
    sourceExcerpt:
      "Gradient descent updates parameters in the opposite direction of the gradient of the loss function, scaled by the learning rate.",
    generatedLabel: "Generated flashcard",
    generatedPrompt: "Why does the learning rate affect convergence stability in gradient descent?",
    explanation:
      "Flashcard front giữ nguyên câu hỏi tiếng Anh, còn mặt sau giải thích ngắn gọn hơn để người học tự recall thay vì chỉ copy định nghĩa.",
    citation: citations.mlGradient,
    resultLabel: "Deck state",
    resultValue: `${decks[0].dueCount} due · ${decks[0].newCount} new · ${decks[0].masteredCount} mastered`,
    resultDetail: "Người học thấy ngay số thẻ đến hạn và có thể review theo nhịp spaced repetition thay vì đọc lại tài liệu từ đầu.",
    tone: "mastery",
  },
  {
    id: "video-checkpoint",
    eyebrow: "Video lecture → Checkpoints",
    title: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
    description:
      "Ví dụ cho video learning: người học đang xem thì video tự dừng ở checkpoint và hỏi lại nội dung vừa xuất hiện trong transcript.",
    icon: CirclePlay,
    sourceLabel: "Transcript excerpt · 05:12–05:58",
    sourceExcerpt:
      "TCP dùng cơ chế bắt tay ba bước (three-way handshake): SYN, SYN-ACK, ACK để thiết lập kết nối tin cậy trước khi truyền dữ liệu.",
    generatedLabel: "Generated checkpoint",
    generatedPrompt: videoCheckpoints[0].question.stem,
    explanation:
      "Checkpoint mode không đợi đến cuối video mới hỏi. Nó dùng chính đoạn transcript vừa xem để kiểm tra hiểu biết ngay tại chỗ.",
    citation: citations.videoTcp,
    resultLabel: "Result state",
    resultValue: "1 checkpoint hoàn thành · 1 checkpoint bị bỏ lỡ",
    resultDetail: "Checkpoint bỏ lỡ được đánh dấu để xem lại đúng timestamp thay vì bắt người học tua thủ công cả video.",
    tone: "warning",
  },
  {
    id: "exam-practice",
    eyebrow: "Exam chapter → Practice test",
    title: "Đề cương ôn thi Hệ điều hành — Chủ đề Đồng bộ tiến trình",
    description:
      "Ví dụ practice mode cho giai đoạn nước rút: hệ thống gom nhiều ý quan trọng trong một chương để tạo mini test và breakdown theo topic.",
    icon: ClipboardCheck,
    sourceLabel: "Source excerpt · Trang 24",
    sourceExcerpt:
      "Semaphore là biến đếm dùng để đồng bộ tiến trình; thao tác wait() giảm giá trị, signal() tăng giá trị một cách nguyên tử.",
    generatedLabel: "Generated practice question",
    generatedPrompt: "Thao tác wait() trên một semaphore làm gì?",
    explanation:
      "Practice test không chỉ hiện đúng/sai. Nó cho người học thấy topic nào đang tụt, câu nào nên biến thành flashcard và citation nào cần đọc lại trước kỳ thi.",
    citation: citations.osSync,
    resultLabel: "Result state",
    resultValue: "18/25 correct · Weakest area: Đồng bộ tiến trình",
    resultDetail: "Kết quả kéo theo next actions rõ ràng: review source, retry mistakes hoặc hỏi Tutor ngay trên cùng chủ đề.",
    tone: "review",
  },
] as const;

export default function ExamplesPage() {
  return (
    <PublicShell>
      <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="brand">Example gallery</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
              Xem output thật trước khi đăng ký: nguồn, câu hỏi, explanation và result state đều mở ra được.
            </h1>
            <p className="mt-5 text-lg leading-8 text-ink-600">
              Gallery này giúp người học và giáo viên kiểm tra chất lượng grounded outputs trước khi tải tài liệu của riêng mình. Mỗi card đều cho thấy source excerpt, generated prompt, explanation, citation và trạng thái kết quả sau khi học.
            </p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <TrustStat
              label="Không cần signup để hiểu output"
              value="4 workflow mẫu"
              detail="PDF quiz, English flashcards, video checkpoints và exam practice đều có thể inspect ngay."
            />
            <TrustStat
              label="Trust surface luôn hiện"
              value="Citation + result state"
              detail="Visitors không chỉ thấy “đầu ra đẹp”, mà còn thấy căn cứ và chuyện gì xảy ra sau khi làm bài."
            />
            <TrustStat
              label="Vietnamese-capable"
              value="Nội dung dài, có dấu"
              detail="Example copy hỗ trợ tài liệu tiếng Việt, mixed-language materials và exam-oriented workflows."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Inspectable cards"
          title="Mỗi ví dụ là một mini workflow hoàn chỉnh"
          description="Thay vì chỉ show screenshot, mỗi card bên dưới phơi bày nội dung nguồn, generated output, explanation, citation và trạng thái sau khi học để visitor đánh giá chất lượng một cách thực tế hơn."
        />
        <div className="mt-8 grid gap-6">
          {exampleItems.map((example) => (
            <ExampleCard key={example.id} example={example} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Card className="border-brand-100 bg-brand-50/70">
            <CardBody className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-700">From sample to your own material</p>
                <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
                  Nếu các ví dụ này đúng kiểu output bạn cần, hãy bắt đầu với tài liệu thật của bạn.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-ink-600 sm:text-base">
                  Bạn có thể bắt đầu miễn phí với PDF/text, hoặc xem trang pricing để hiểu credits, video limits và policy top-up trước khi upload nội dung dài hơn.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <LinkButton href={routes.signup}>
                  Start free <ArrowRight className="h-4 w-4" />
                </LinkButton>
                <LinkButton href={routes.pricing} variant="outline">
                  Xem pricing
                </LinkButton>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>
    </PublicShell>
  );
}

function ExampleCard({ example }: { example: ExampleItem }) {
  const Icon = example.icon;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" />
            </div>
            <Badge tone={example.tone}>{example.eyebrow}</Badge>
          </div>
          <div>
            <CardTitle className="text-lg">{example.title}</CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600">{example.description}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-ink-200 bg-ink-50/70 px-4 py-3 text-sm text-ink-700 lg:max-w-xs">
          <p className="font-semibold text-ink-900">{example.resultLabel}</p>
          <p className="mt-2 text-base font-semibold text-ink-900">{example.resultValue}</p>
          <p className="mt-1 text-sm leading-6 text-ink-500">{example.resultDetail}</p>
        </div>
      </CardHeader>
      <CardBody className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <DetailPanel label={example.sourceLabel} tone="source">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-ink-700">{example.sourceExcerpt}</pre>
        </DetailPanel>
        <DetailPanel label={example.generatedLabel} tone="output">
          <p className="text-base font-semibold text-ink-900">{example.generatedPrompt}</p>
          <p className="mt-3 text-sm leading-6 text-ink-600">{example.explanation}</p>
        </DetailPanel>
        <div className="lg:col-span-2">
          <CitationSnippet citation={example.citation} />
        </div>
      </CardBody>
    </Card>
  );
}

function DetailPanel({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "source" | "output";
  children: React.ReactNode;
}) {
  const toneClass = tone === "source"
    ? "border-ink-200 bg-ink-50/70"
    : "border-brand-100 bg-brand-50/70";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function TrustStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3 card-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
      <p className="mt-1 text-sm leading-6 text-ink-500">{detail}</p>
    </div>
  );
}
