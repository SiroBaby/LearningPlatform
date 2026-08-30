import type { Metadata } from "next";
import { ArrowRight, Bot, ChartNoAxesColumn, CirclePlay, FileQuestion, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  attempts,
  citations,
  classrooms,
  courses,
  decks,
  dueCardsToday,
  exams,
  notifications,
  quizzes,
  videoCheckpoints,
  weakTopics,
} from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { PublicShell } from "@/components/layout";
import {
  Badge,
  BarChart,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationSnippet,
  LinkButton,
  ProgressBar,
  ProgressRing,
  SectionHeading,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Sản phẩm",
  description:
    "Khám phá cách LearningPlatform biến tài liệu thành quiz, checkpoint, tutor, flashcards, analytics và workflow ôn thi có trích dẫn nguồn rõ ràng.",
};

const readyQuiz = quizzes[0];
const latestAttempt = attempts[0];
const videoCheckpoint = videoCheckpoints[1];
const reviewDeck = decks[0];
const featuredCourse = courses[0];
const featuredExam = exams[0];
const featuredClassroom = classrooms[0];

export default function ProductPage() {
  return (
    <PublicShell>
      <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div className="space-y-8">
            <Badge tone="brand">Product walkthrough</Badge>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
                Một learning workflow rõ ràng từ tài liệu gốc đến hành động ôn tập tiếp theo.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-ink-600">
                Mỗi capability đều xoay quanh một câu hỏi thực tế: người học cần được hỏi gì, phản hồi gì,
                và trích dẫn nguồn nào để tin rằng mình đang học đúng phần cần học.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={routes.signup} size="lg">
                Start free <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={routes.examples} variant="outline" size="lg">
                Xem demo output
              </LinkButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard
                label="Outputs từ 1 tài liệu"
                value="Quiz · Flashcards · Tutor"
                hint="Có thể mở rộng sang checkpoint video và practice exam"
              />
              <MetricCard
                label="Vòng lặp phản hồi"
                value={`${latestAttempt.correctCount}/${latestAttempt.totalCount} câu được review`}
                hint="Câu sai, explanation và next action xuất hiện trong cùng một flow"
              />
              <MetricCard
                label="Trust surface"
                value="Citation hiện diện ở mọi output"
                hint="Trang, timestamp, source snippet đều nhìn thấy được"
              />
            </div>
          </div>

          <Card>
            <CardHeader className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">Learning cockpit preview</p>
                <p className="mt-1 text-sm text-ink-500">
                  Hệ thống không dừng ở việc “generate”, mà luôn đẩy người học sang bước trả lời, nhận phản hồi và
                  ôn lại.
                </p>
              </div>
              <Badge tone="success">Live mock</Badge>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-brand-700">Document → Quiz</p>
                    <h2 className="mt-1 text-lg font-semibold text-ink-900">{readyQuiz.documentTitle}</h2>
                  </div>
                  <Badge tone="mastery">{readyQuiz.questionCount} câu hỏi</Badge>
                </div>
                <p className="mt-4 text-sm font-medium text-ink-900">{readyQuiz.questions[0].stem}</p>
                <CitationSnippet citation={readyQuiz.questions[0].citation} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="border-review-100 bg-review-50/70">
                  <CardBody className="space-y-3">
                    <p className="text-sm font-semibold text-review-600">Review queue</p>
                    <ProgressBar value={72} tone="review" />
                    <p className="text-sm text-ink-700">
                      {dueCardsToday.length} flashcard đến hạn và 1 checkpoint bị bỏ lỡ được gom vào cùng hàng đợi.
                    </p>
                  </CardBody>
                </Card>
                <Card className="border-success-100 bg-success-50/70">
                  <CardBody className="space-y-3">
                    <p className="text-sm font-semibold text-success-700">Transparency</p>
                    <p className="text-sm text-ink-700">
                      Nếu Tutor không tìm thấy đủ bằng chứng trong nguồn, giao diện phải nói rõ điều đó thay vì trả lời
                      mơ hồ.
                    </p>
                  </CardBody>
                </Card>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Capability map"
          title="Mỗi surface giải quyết một vấn đề học tập cụ thể"
          description="Trang sản phẩm không chỉ liệt kê feature. Mỗi section cho thấy user problem, UI preview, output example và lý do vì sao output đó đáng tin hơn một AI chat trả lời chung chung."
        />
      </section>

      <FeatureSection
        eyebrow="Document → Quiz"
        icon={FileQuestion}
        title="Biến chương PDF dài thành câu hỏi active recall có explanation và citation"
        problem="Người học thường đọc xong tưởng hiểu, nhưng đến lúc tự trả lời thì không nhớ được khái niệm cốt lõi nào cần giữ lại."
        outputExample={`Quiz ${readyQuiz.title} bao phủ ${readyQuiz.coverageTopics.join(" · ")} với mix độ khó rõ ràng.`}
        trustworthyReason="Mỗi explanation đều gắn với source snippet và số trang, nên người học có thể kiểm tra logic thay vì tin câu trả lời mù quáng."
        preview={<DocumentQuizPreview />}
      />

      <FeatureSection
        eyebrow="Video checkpoints"
        icon={CirclePlay}
        title="Dừng video ở đúng đoạn cần nhớ để buộc người học trả lời ngay"
        problem="Video bài giảng rất dễ bị xem thụ động. Sau 20 phút, người học thường không biết mình có thật sự hiểu đoạn vừa xem hay không."
        outputExample="Checkpoint mode tự pause tại timestamp quan trọng, hỏi lại khái niệm vừa xuất hiện trong transcript và chỉ ra đúng đoạn nguồn để xem lại."
        trustworthyReason="Checkpoint luôn bám vào transcript/timestamp vừa xem; explanation đi kèm citation thời gian cụ thể thay vì chỉ tóm tắt lại bằng lời."
        preview={<VideoCheckpointPreview />}
        reverse
      />

      <FeatureSection
        eyebrow="AI Tutor"
        icon={Bot}
        title="Tutor chỉ trả lời trong phạm vi có bằng chứng và luôn nói rõ context đang dùng"
        problem="Khi hỏi free-form, người học cần câu trả lời có căn cứ từ tài liệu đang học chứ không muốn một câu trả lời chung chung ngoài phạm vi ôn thi."
        outputExample="Tutor có thể giải thích lại, so sánh khái niệm hoặc tạo follow-up quiz, nhưng mỗi câu trả lời đều hiển thị source snippet và document context."
        trustworthyReason="Nếu không đủ nguồn, Tutor phải nói ‘không đủ bằng chứng’ thay vì bịa thêm. Đây là trust contract quan trọng nhất của sản phẩm."
        preview={<TutorPreview />}
      />

      <FeatureSection
        eyebrow="Flashcards & review"
        icon={ShieldCheck}
        title="Tự gom câu sai, thẻ đến hạn và phần quên nhiều vào một review queue nhất quán"
        problem="Sau khi làm quiz, người học biết mình sai nhưng không có một hàng đợi ôn tập rõ ràng để quay lại đúng lúc."
        outputExample={`Deck ${reviewDeck.title} giữ cả thẻ mới, thẻ đến hạn và thẻ mastered trong cùng một flow để người học thấy mình đang tiến bộ ở đâu.`}
        trustworthyReason="Mỗi flashcard vẫn giữ citation nguồn để người học không tách rời việc ghi nhớ khỏi tài liệu gốc."
        preview={<FlashcardPreview />}
        reverse
      />

      <FeatureSection
        eyebrow="Weak-topic analytics"
        icon={ChartNoAxesColumn}
        title="Hiện rõ phần nào yếu, vì sao yếu và nên hành động gì tiếp theo"
        problem="Một điểm số tổng không đủ cho người học biết cần ôn lại chủ đề nào trước kỳ thi."
        outputExample="Analytics bám vào câu sai, checkpoint bỏ lỡ và deck đến hạn để gợi ý next action: review source, retry quiz, hỏi Tutor hoặc quay lại video segment."
        trustworthyReason="Mỗi weak topic đều dẫn ngược về bằng chứng cụ thể: câu nào sai, citation nào liên quan và document nào gây hụt kiến thức."
        preview={<AnalyticsPreview />}
      />

      <FeatureSection
        eyebrow="Exam prep"
        icon={ShieldCheck}
        title="Biến tài liệu rời rạc thành readiness view, review plan và practice mode có ưu tiên"
        problem="Trước kỳ thi, người học không thiếu tài liệu — họ thiếu một ưu tiên rõ ràng cho hôm nay nên ôn gì trước."
        outputExample={`Exam dashboard cho ${featuredExam.name} ghép readiness, due review và deadline của course ${featuredCourse.name} vào cùng một bức tranh.`}
        trustworthyReason="Readiness được giải thích bằng coverage, độ chính xác quiz và weak-topic evidence thay vì một điểm tổng bí ẩn."
        preview={<ExamPrepPreview />}
        reverse
      />

      <FeatureSection
        eyebrow="Teacher / classroom"
        icon={Users}
        title="Cùng một visual system, nhưng thêm lớp điều phối cho giáo viên và tutor"
        problem="Giáo viên không chỉ cần sinh câu hỏi; họ cần biết lớp nào đang yếu ở chủ đề nào và assignment nào chưa được nộp."
        outputExample={`Teacher view của ${featuredClassroom.name} cho thấy mastery chung, assignment progress và nhóm sinh viên cần can thiệp sớm.`}
        trustworthyReason="Analytics lớp vẫn bám vào attempt và source-grounded outputs của từng tài liệu, tránh việc dashboard chỉ là những con số rời rạc."
        preview={<TeacherPreview />}
      />

      <section className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Built for trust"
            title="Những lời hứa sản phẩm giao diện phải làm rõ"
            description="AI ở đây là trợ lý học tập có giới hạn. Giao diện phải cho người học thấy đâu là bằng chứng, đâu là limit, và đâu là bước tiếp theo hợp lý nhất."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            <TrustCard
              title="Citation không bị ẩn"
              description="Question, explanation, tutor response và checkpoint đều có cách mở source snippet ngay trong flow học."
            />
            <TrustCard
              title="Không overpromise"
              description="Sản phẩm không hứa AI luôn đúng; sản phẩm hứa người học luôn thấy được căn cứ để tự kiểm tra."
            />
            <TrustCard
              title="Progress minh bạch"
              description="Processing, review queue, usage limits và weak-topic logic đều được giải thích bằng trạng thái dễ hiểu."
            />
          </div>
          <Card className="mt-10 border-brand-100 bg-brand-50/70">
            <CardBody className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-700">Ready to explore</p>
                <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
                  Muốn xem output thật trước khi tạo tài khoản?
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-ink-600 sm:text-base">
                  Mở gallery examples để inspect source excerpt, generated question, explanation, citation và result state của từng workflow.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <LinkButton href={routes.examples}>View example gallery</LinkButton>
                <LinkButton href={routes.pricing} variant="outline">
                  So sánh plan
                </LinkButton>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>
    </PublicShell>
  );
}

function FeatureSection({
  eyebrow,
  icon: Icon,
  title,
  problem,
  outputExample,
  trustworthyReason,
  preview,
  reverse = false,
}: {
  eyebrow: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  problem: string;
  outputExample: string;
  trustworthyReason: string;
  preview: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section className="border-t border-ink-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:px-8">
        <div className={cn("space-y-5", reverse && "lg:order-2") }>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" />
            </div>
            <Badge tone="brand">{eyebrow}</Badge>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h2>
            <p className="text-base leading-7 text-ink-600">{problem}</p>
          </div>
          <InfoBlock label="Output example" value={outputExample} tone="brand" />
          <InfoBlock label="Why trustworthy" value={trustworthyReason} tone="success" />
        </div>
        <div className={reverse ? "lg:order-1" : undefined}>{preview}</div>
      </div>
    </section>
  );
}

function DocumentQuizPreview() {
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink-900">{readyQuiz.title}</p>
          <p className="mt-1 text-sm text-ink-500">Question-by-question review bám theo tài liệu gốc</p>
        </div>
        <Badge tone="success">Ready</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
          <p className="text-sm font-medium text-ink-900">{readyQuiz.questions[0].stem}</p>
          <div className="mt-3 space-y-2">
            {readyQuiz.questions[0].options.map((option, index) => (
              <div
                key={option.id}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm",
                  index === 0
                    ? "border-brand-300 bg-white text-ink-900"
                    : "border-brand-100 bg-white/80 text-ink-600",
                )}
              >
                {option.text}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
            Difficulty mix: easy {readyQuiz.difficultyMix.easy} · medium {readyQuiz.difficultyMix.medium} · hard {readyQuiz.difficultyMix.hard}
          </div>
        </div>
        <CitationSnippet citation={readyQuiz.questions[0].citation} />
        <div className="grid gap-3 sm:grid-cols-2">
          <StatPanel label="Attempt gần nhất" value={`${latestAttempt.scorePct}%`} hint="Sai nhiều nhất ở Đồng bộ tiến trình" />
          <StatPanel label="Next action" value="Review mistakes" hint="Tạo thẻ ôn tập từ câu sai hoặc hỏi Tutor" />
        </div>
      </CardBody>
    </Card>
  );
}

function VideoCheckpointPreview() {
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink-900">Bài giảng Mạng máy tính — checkpoint mode</p>
          <p className="mt-1 text-sm text-ink-500">Video pause tại đúng đoạn vừa giải thích khái niệm</p>
        </div>
        <Badge tone="warning">Checkpoint</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-ink-200 bg-ink-900 p-4 text-white">
          <div className="flex items-center justify-between gap-3 text-sm text-white/80">
            <span>06:40 / 23:40</span>
            <span>Checkpoint mode on</span>
          </div>
          <div className="mt-4 h-40 rounded-2xl border border-white/10 bg-gradient-to-br from-brand-700/35 to-ink-800" />
          <div className="mt-4 h-2 rounded-full bg-white/10">
            <div className="h-2 w-[48%] rounded-full bg-brand-400" />
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">{videoCheckpoint.question.stem}</p>
            <p className="mt-2 text-sm leading-6 text-white/80">{videoCheckpoint.question.explanation}</p>
          </div>
        </div>
        <CitationSnippet citation={videoCheckpoint.question.citation} />
        <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm text-ink-700">
          Nếu người học bỏ lỡ checkpoint, hệ thống đưa đoạn video này vào review queue để xem lại đúng timestamp.
        </div>
      </CardBody>
    </Card>
  );
}

function TutorPreview() {
  return (
    <Card>
      <CardHeader>
        <p className="text-sm font-semibold text-ink-900">Tutor với document context rõ ràng</p>
        <p className="mt-1 text-sm text-ink-500">Scope: {featuredCourse.name} · 2 documents in context</p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
          User: “Giải thích đơn giản sự khác nhau giữa TCP và UDP trong tài liệu này.”
        </div>
        <div className="rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
          <p className="text-sm leading-6 text-ink-700">
            TCP thiết lập kết nối bằng three-way handshake nên ưu tiên độ tin cậy; UDP bỏ qua bước này để đổi lấy độ trễ thấp, phù hợp streaming và game thời gian thực.
          </p>
          <div className="mt-4">
            <CitationSnippet citation={citations.videoUdp} />
          </div>
        </div>
        <div className="rounded-2xl border border-success-100 bg-success-50 p-4 text-sm text-ink-700">
          Nếu câu hỏi đi ra ngoài phạm vi tài liệu, Tutor sẽ báo không đủ source evidence thay vì tự điền thêm kiến thức không kiểm soát.
        </div>
      </CardBody>
    </Card>
  );
}

function FlashcardPreview() {
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink-900">{reviewDeck.title}</p>
          <p className="mt-1 text-sm text-ink-500">Due review rõ ràng trước, mastered sau</p>
        </div>
        <ProgressRing value={68} size={72} tone="mastery" label="Mastery estimate" />
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatPanel label="Due today" value={String(reviewDeck.dueCount)} hint="Ưu tiên đầu buổi học" />
          <StatPanel label="New cards" value={String(reviewDeck.newCount)} hint="Chỉ thêm khi còn sức học" />
          <StatPanel label="Mastered" value={String(reviewDeck.masteredCount)} hint="Không cần lặp lại quá sớm" />
        </div>
        <div className="rounded-2xl border border-mastery-100 bg-mastery-50/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mastery-600">Front</p>
          <p className="mt-2 text-base font-medium text-ink-900">{reviewDeck.cards[0].front}</p>
          <div className="mt-4 rounded-2xl border border-white/70 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Back</p>
            <p className="mt-2 text-sm leading-6 text-ink-700">{reviewDeck.cards[0].back}</p>
          </div>
        </div>
        <CitationSnippet citation={reviewDeck.cards[0].citation} />
      </CardBody>
    </Card>
  );
}

function AnalyticsPreview() {
  const weakTopicChart: Array<{
    label: string;
    value: number;
    tone: "error" | "warning" | "brand";
  }> = weakTopics.map((topic) => ({
    label: topic.name,
    value: topic.masteryPct,
    tone: topic.masteryPct < 45 ? "error" : topic.masteryPct < 55 ? "warning" : "brand",
  }));

  return (
    <Card>
      <CardHeader>
        <p className="text-sm font-semibold text-ink-900">Weak-topic view</p>
        <p className="mt-1 text-sm text-ink-500">Không chỉ cho biết điểm thấp, mà còn cho biết cần quay lại nguồn nào</p>
      </CardHeader>
      <CardBody className="space-y-5">
        <BarChart
          data={weakTopicChart}
          summary="Ba chủ đề đang yếu nhất hiện tại là UDP vs TCP, Đồng bộ tiến trình và Gradient descent."
        />
        <div className="grid gap-3">
          {weakTopics.map((topic) => (
            <div key={topic.id} className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                  <p className="mt-1 text-sm text-ink-500">{topic.missedQuestions} câu sai liên quan</p>
                </div>
                <Badge tone={topic.masteryPct < 45 ? "error" : "warning"}>{topic.masteryPct}% mastery</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-700">Gợi ý: review source → retry quiz → hỏi Tutor từ citation liên quan.</p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ExamPrepPreview() {
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink-900">{featuredExam.name}</p>
          <p className="mt-1 text-sm text-ink-500">Deadline {featuredExam.date} · Course {featuredCourse.name}</p>
        </div>
        <ProgressRing value={featuredExam.readinessPct} tone="review" size={72} label="Exam readiness" />
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatPanel label="Target score" value={`${featuredExam.targetScorePct}%`} hint="Kỳ vọng trước khi vào practice mode" />
          <StatPanel label="Today’s focus" value="Đồng bộ tiến trình" hint="Câu sai xuất hiện lặp lại trong quiz gần nhất" />
        </div>
        <div className="rounded-2xl border border-review-100 bg-review-50/70 p-4">
          <p className="text-sm font-semibold text-review-600">Recommended queue</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-700">
            <li>1. Retry 2 câu sai trong quiz Chương 3</li>
            <li>2. Ôn 2 flashcard đến hạn</li>
            <li>3. Xem lại checkpoint UDP ở mốc 10:40</li>
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function TeacherPreview() {
  const publishedAssignment = notifications.find((notification) => notification.type === "quiz_result");

  return (
    <Card>
      <CardHeader>
        <p className="text-sm font-semibold text-ink-900">{featuredClassroom.name}</p>
        <p className="mt-1 text-sm text-ink-500">Teacher dashboard dùng cùng visual system nhưng thêm lớp điều phối</p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatPanel label="Students" value={String(featuredClassroom.studentCount)} hint="Theo dõi theo class và assignment" />
          <StatPanel label="Class mastery" value={`${featuredClassroom.avgMasteryPct}%`} hint="Dựa trên attempt và review data" />
          <StatPanel label="Suggested intervention" value="2 learners" hint="Cần nhắc review ngay trong tuần" />
        </div>
        <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
          <p className="text-sm font-semibold text-ink-900">Weak topics across class</p>
          <div className="mt-3 space-y-3">
            {featuredClassroom.students.map((student) => (
              <div key={student.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white bg-white px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">{student.name}</p>
                  <p className="text-sm text-ink-500">{student.weakTopics.join(" · ")}</p>
                </div>
                <Badge tone={student.missingAssignments > 0 ? "warning" : "success"}>
                  {student.missingAssignments > 0
                    ? `${student.missingAssignments} assignment chưa nộp`
                    : `${student.avgScorePct}% avg score`}
                </Badge>
              </div>
            ))}
          </div>
        </div>
        <p className="text-sm text-ink-500">
          {publishedAssignment
            ? `Teacher view có thể deep-link đến result, assignment và document để can thiệp đúng chỗ thay vì chỉ xem điểm tổng.`
            : "Teacher view giữ cùng ngôn ngữ citation và mastery để tránh dashboard trở nên xa rời việc học thực tế."}
        </p>
      </CardBody>
    </Card>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3 card-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
      <p className="mt-1 text-sm leading-6 text-ink-500">{hint}</p>
    </div>
  );
}

function StatPanel({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
      <p className="mt-1 text-sm leading-6 text-ink-500">{hint}</p>
    </div>
  );
}

function InfoBlock({ label, value, tone }: { label: string; value: string; tone: "brand" | "success" }) {
  const toneClass = tone === "brand"
    ? "border-brand-100 bg-brand-50/70"
    : "border-success-100 bg-success-50/70";

  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className="mt-2 text-sm leading-6 text-ink-700">{value}</p>
    </div>
  );
}

function TrustCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm leading-6 text-ink-600">{description}</p>
      </CardBody>
    </Card>
  );
}
