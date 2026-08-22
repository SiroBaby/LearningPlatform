import { ArrowRight, CheckCircle2, FileText, GraduationCap, PlayCircle, Quote, ShieldCheck, Sparkles } from "lucide-react";
import { PublicShell } from "@/components/layout";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationSnippet,
  LinkButton,
  ProgressBar,
  SectionHeading,
} from "@/components/ui";
import { citations } from "@/lib/mock-data";
import { routes } from "@/lib/routes";

const features = [
  {
    title: "Document → Quiz",
    description: "Tải slide, PDF, ghi chú. Hệ thống dựng câu hỏi active recall có giải thích và trích dẫn nguồn.",
    icon: FileText,
  },
  {
    title: "Video checkpoints",
    description: "Video tự dừng ở các checkpoint để hỏi bạn về phần vừa xem thay vì để học thụ động.",
    icon: PlayCircle,
  },
  {
    title: "Tutor grounded by source",
    description: "Tutor chỉ trả lời khi tìm thấy bằng chứng trong tài liệu và luôn cho bạn nhảy về nguồn gốc.",
    icon: Quote,
  },
  {
    title: "Review queue",
    description: "Tự gom câu sai, thẻ đến hạn và điểm yếu để bạn biết hôm nay nên học gì trước.",
    icon: Sparkles,
  },
];

export default function Home() {
  return (
    <PublicShell>
      <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div className="space-y-8">
            <Badge tone="brand">Source-grounded learning for Vietnamese & SEA learners</Badge>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
                Turn your study materials into quizzes, checkpoints, and feedback you can trust.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-ink-600">
                Upload a PDF or lecture video. LearningPlatform creates active recall tasks with source citations, so you can learn, answer, get feedback, and revisit weak areas faster.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={routes.signup} size="lg">
                Start free <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={routes.examples} variant="outline" size="lg">
                View example
              </LinkButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric title="Ready in minutes" value="PDF → Quiz" />
              <Metric title="Trust first" value="Visible citations" />
              <Metric title="Best for" value="Exam prep" />
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf
                  </p>
                  <p className="mt-1 text-sm text-ink-500">
                    Upload → Generate quiz → Review weak areas
                  </p>
                </div>
                <Badge tone="success">Ready</Badge>
              </CardHeader>
              <CardBody className="space-y-5">
                <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-brand-700">Quiz preview</p>
                      <h3 className="mt-2 text-lg font-semibold text-ink-900">
                        Vì sao context switching tạo overhead cho hệ thống?
                      </h3>
                    </div>
                    <Badge tone="mastery">Quiz</Badge>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {[
                      "Vì CPU phải lưu và khôi phục trạng thái tiến trình…",
                      "Vì tiến trình mới luôn cần nhiều bộ nhớ hơn",
                      "Vì hệ điều hành phải nạp lại chương trình từ đĩa",
                    ].map((option, index) => (
                      <div
                        key={option}
                        className={`rounded-xl border px-3 py-2.5 text-sm ${
                          index === 0
                            ? "border-brand-300 bg-white text-ink-900"
                            : "border-brand-100 bg-white/70 text-ink-600"
                        }`}
                      >
                        {option}
                      </div>
                    ))}
                  </div>
                  <CitationSnippet citation={citations.osContextSwitch} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="border-brand-100 bg-brand-50/60">
                    <CardBody className="space-y-2">
                      <p className="text-sm font-semibold text-brand-700">Processing pipeline</p>
                      <ProgressBar value={84} />
                      <p className="text-sm text-ink-600">Extract → Chunk → Generate → Validate</p>
                    </CardBody>
                  </Card>
                  <Card className="border-review-100 bg-review-50/70">
                    <CardBody className="space-y-2">
                      <p className="text-sm font-semibold text-review-600">Weak topic surfaced</p>
                      <p className="text-sm text-ink-700">Đồng bộ tiến trình</p>
                      <p className="text-sm text-ink-600">Đề xuất: review source → retry mistakes → ask tutor</p>
                    </CardBody>
                  </Card>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="One loop, made obvious"
          description="Upload learning material → AI creates active recall tasks → learner answers → system gives feedback → learner improves weak areas."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {features.map(({ title, description, icon: Icon }) => (
            <Card key={title}>
              <CardBody className="space-y-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{title}</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-16 sm:px-6 lg:grid-cols-3 lg:px-8">
          <TrustCard
            icon={ShieldCheck}
            title="Grounded citations, not blind answers"
            description="Every question, explanation, and tutor response can point back to page, timestamp, or source snippet."
          />
          <TrustCard
            icon={CheckCircle2}
            title="Calm study interface"
            description="The UI behaves like a focused learning cockpit instead of a noisy AI toy or generic admin panel."
          />
          <TrustCard
            icon={GraduationCap}
            title="Built for Vietnamese study workflows"
            description="Long course names, exam prep flows, mixed Vietnamese-English materials, and mobile review are first-class."
          />
        </div>
      </section>
    </PublicShell>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3 card-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{title}</p>
      <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
    </div>
  );
}

function TrustCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success-50 text-success-600">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
        </div>
      </CardBody>
    </Card>
  );
}
