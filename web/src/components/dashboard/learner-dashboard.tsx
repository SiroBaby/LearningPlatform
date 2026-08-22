import {
  ArrowRight,
  BrainCircuit,
  CircleAlert,
  Clock3,
  ListChecks,
  RefreshCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  Badge,
  BarChart,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CitationSnippet,
  EmptyState,
  LinkButton,
  ProgressBar,
  ProgressRing,
  StatusPill,
  StepTimeline,
  TrendChart,
  TypeBadge,
} from "@/components/ui";
import {
  attempts,
  courses,
  documents,
  dueCardsToday,
  formatDate,
  formatDateTime,
  getQuiz,
  jobs,
  studyTasks,
  usage,
  weakTopics,
} from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type {
  Attempt,
  LearningDocument,
  OutputKind,
  StudyTask,
  WeakTopic,
} from "@/lib/types";

const weeklyAccuracyData = [
  { label: "T2", value: 48, tone: "brand" },
  { label: "T3", value: 57, tone: "brand" },
  { label: "T4", value: 62, tone: "brand" },
  { label: "T5", value: 69, tone: "brand" },
  { label: "T6", value: 74, tone: "brand" },
  { label: "T7", value: 79, tone: "mastery" },
  { label: "CN", value: 86, tone: "success" },
] as const;

const outputLabels: Record<OutputKind, string> = {
  quiz: "Quiz",
  flashcards: "Flashcards",
  tutor: "Tutor",
  checkpoints: "Checkpoints",
};

const taskToneMap: Record<StudyTask["type"], "brand" | "mastery" | "review"> = {
  flashcards: "review",
  retry_quiz: "brand",
  video_checkpoint: "mastery",
  read_source: "brand",
  ask_tutor: "mastery",
  practice_exam: "review",
};

const taskLabelMap: Record<StudyTask["type"], string> = {
  flashcards: "Flashcards",
  retry_quiz: "Retry quiz",
  video_checkpoint: "Checkpoint",
  read_source: "Review source",
  ask_tutor: "Ask tutor",
  practice_exam: "Practice exam",
};

const currentStreakDays = 6;
const todayReadinessPct = 78;
const activeStudyDays = 5;

export function LearnerDashboard() {
  const readyDocuments = documents.filter((document) => document.status === "ready").slice(0, 3);
  const runningDocument = documents.find((document) => document.status === "processing");
  const queuedDocument = documents.find((document) => document.status === "uploaded");
  const failedDocument = documents.find((document) => document.status === "failed");
  const nextTask = studyTasks.find((task) => !task.done);
  const latestAttempt = getLatestAttempt();
  const latestQuiz = latestAttempt ? getQuiz(latestAttempt.quizId) : undefined;
  const highlightedWeakTopic = weakTopics[0];
  const creditRemainingPct = Math.round(
    (usage.creditsRemaining / usage.creditsTotal) * 100,
  );
  const reviewCompletionPct = Math.round(
    (studyTasks.filter((task) => task.done).length / studyTasks.length) * 100,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
        <PrimaryActionCard
          nextTask={nextTask}
          readyCount={readyDocuments.length}
          dueCount={dueCardsToday.length}
          reviewCompletionPct={reviewCompletionPct}
        />
        <RecommendedNextActionCard weakTopic={highlightedWeakTopic} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <TodayReviewQueueCard tasks={studyTasks} />
        <ContinueAttemptCard attempt={latestAttempt} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <ProcessingJobsCard
          runningDocument={runningDocument}
          queuedDocument={queuedDocument}
          failedDocument={failedDocument}
        />
        <RecentlyReadyDocumentsCard documents={readyDocuments} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <WeakTopicsCard topics={weakTopics} />
        <StudyProgressCard reviewCompletionPct={reviewCompletionPct} />
      </div>

      <UsageWarningCard creditRemainingPct={creditRemainingPct} reviewCompletionPct={reviewCompletionPct} />

      {latestQuiz ? (
        <p className="text-sm text-ink-500">
          Quiz gần nhất: <span className="font-medium text-ink-700">{latestQuiz.title}</span> với {latestQuiz.questionCount} câu.
          Dashboard này dùng dữ liệu mock nên các CTA ngoài trang <span className="font-medium text-ink-700">/home</span> và <span className="font-medium text-ink-700">/upload</span> chỉ minh họa cho luồng tiếp theo.
        </p>
      ) : null}
    </div>
  );
}

function PrimaryActionCard({
  nextTask,
  readyCount,
  dueCount,
  reviewCompletionPct,
}: {
  nextTask?: StudyTask;
  readyCount: number;
  dueCount: number;
  reviewCompletionPct: number;
}) {
  const currentCourse = courses[0];

  return (
    <Card className="overflow-hidden border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white">
      <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-5">
          <div className="space-y-3">
            <Badge tone="brand">Primary action</Badge>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
                Tiếp tục vòng lặp active recall hôm nay
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600 sm:text-base">
                Upload tài liệu mới hoặc quay lại phần ôn tập ưu tiên nhất. Mục tiêu hôm nay là xử lý review queue trước khi mở quiz mới.
              </p>
            </div>
          </div>

          {nextTask ? (
            <div className="rounded-3xl border border-brand-100 bg-white/90 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-brand-700">Nên làm trước</p>
                  <p className="mt-1 text-base font-semibold text-ink-900">{nextTask.title}</p>
                  <p className="mt-1 text-sm text-ink-600">{nextTask.documentTitle}</p>
                </div>
                <Badge tone={taskToneMap[nextTask.type]}>{taskLabelMap[nextTask.type]}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-600">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-4 w-4" />
                  {nextTask.estimatedMinutes} phút
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BrainCircuit className="h-4 w-4" />
                  Course focus: {currentCourse.name}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <LinkButton href={routes.upload}>
              Upload tài liệu mới <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <Button variant="secondary" type="button">
              Tiếp tục review queue
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile label="Due today" value={`${dueCount} mục`} tone="review" />
            <MetricTile label="Ready documents" value={`${readyCount} tài liệu`} tone="success" />
            <MetricTile label="Plan completion" value={`${reviewCompletionPct}%`} tone="brand" />
          </div>
        </div>

        <div className="rounded-3xl border border-brand-100 bg-white/90 p-5 lg:w-64">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-start">
            <ProgressRing value={todayReadinessPct} label="Mức sẵn sàng hôm nay" tone="brand" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink-900">Mức sẵn sàng hôm nay</p>
              <p className="text-sm leading-6 text-ink-600">
                Bạn đã duy trì streak <span className="font-semibold text-ink-900">{currentStreakDays} ngày</span> và còn đúng một chủ đề yếu cần xử lý trước khi làm quiz mới.
              </p>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function RecommendedNextActionCard({ weakTopic }: { weakTopic?: WeakTopic }) {
  if (!weakTopic) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Chưa có next action"
        description="Khi bạn có review due hoặc quiz sai gần đây, dashboard sẽ gợi ý hành động tiếp theo ở đây."
        action={<LinkButton href={routes.upload}>Upload tài liệu đầu tiên</LinkButton>}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Recommended next action</p>
            <CardTitle className="mt-1">Ôn lại {weakTopic.name}</CardTitle>
          </div>
          <Badge tone="warning">Ưu tiên cao</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4 text-sm leading-6 text-ink-700">
          Bạn đã bỏ lỡ <span className="font-semibold text-ink-900">{weakTopic.missedQuestions} câu</span> thuộc chủ đề này. Hành động tốt nhất là quay lại nguồn rồi retry ngay khi trí nhớ còn mới.
        </div>

        <CitationSnippet citation={weakTopic.citations[0]} />

        <ol className="space-y-2 text-sm text-ink-600">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">1</span>
            Đọc lại snippet nguồn và nhắc lại ý chính bằng lời của bạn.
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">2</span>
            Làm lại các câu sai liên quan đến {weakTopic.name} trước khi quay lại quiz mới.
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">3</span>
            Nếu vẫn mơ hồ, dùng Tutor để xin ví dụ và so sánh khái niệm.
          </li>
        </ol>

        <div className="flex flex-wrap gap-3">
          <Button type="button">Ôn chủ đề này ngay</Button>
          <Button variant="outline" type="button">
            Xem lại câu sai
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function TodayReviewQueueCard({ tasks }: { tasks: StudyTask[] }) {
  const totalMinutes = tasks.filter((task) => !task.done).reduce((sum, task) => sum + task.estimatedMinutes, 0);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Hôm nay chưa có review due"
        description="Khi có flashcards, câu sai hoặc checkpoint cần xem lại, review queue sẽ xuất hiện ở đây cùng với thời lượng ước tính."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Today’s review queue</p>
            <CardTitle className="mt-1">Những gì bạn nên xử lý trước</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Queue này ưu tiên thẻ quá hạn, câu sai gần đây, rồi đến checkpoint video và follow-up với Tutor.
            </p>
          </div>
          <Badge tone="review">{totalMinutes} phút</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-review-100 bg-review-50/60 px-4 py-3 text-sm text-ink-700">
          <span className="font-semibold text-ink-900">{dueCardsToday.length} flashcard</span> đã đến hạn hôm nay. Hoàn thành chúng trước để giữ nhịp spaced repetition.
        </div>

        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded-2xl border border-ink-100 bg-white p-4 transition-colors hover:border-ink-200"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{task.title}</p>
                    <Badge tone={task.done ? "success" : taskToneMap[task.type]}>
                      {task.done ? "Done" : taskLabelMap[task.type]}
                    </Badge>
                  </div>
                  {task.documentTitle ? (
                    <p className="text-sm text-ink-600">{task.documentTitle}</p>
                  ) : null}
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm text-ink-500">
                  <Clock3 className="h-4 w-4" />
                  {task.estimatedMinutes} phút
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function ContinueAttemptCard({ attempt }: { attempt?: Attempt }) {
  if (!attempt) {
    return (
      <EmptyState
        icon={RefreshCcw}
        title="Chưa có attempt gần đây"
        description="Làm một quiz đầu tiên để dashboard bắt đầu theo dõi tiến độ, điểm yếu và phần nên ôn tiếp theo."
        action={<LinkButton href={routes.upload}>Tạo quiz từ tài liệu</LinkButton>}
      />
    );
  }

  const topicData = attempt.topicBreakdown.map((topic) => ({
    label: topic.topic,
    value: Math.round((topic.correct / topic.total) * 100),
    tone: topic.correct === topic.total ? "success" : topic.correct === 0 ? "error" : "warning",
  })) as {
    label: string;
    value: number;
    tone: "success" | "warning" | "error";
  }[];

  const reviewCount = attempt.answers.filter((answer) => !answer.correct).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Continue attempt</p>
            <CardTitle className="mt-1">Tiếp tục từ lần làm bài gần nhất</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Điểm gần nhất của bạn đã đủ tốt để tiếp tục, nhưng vẫn còn một cụm lỗi nhỏ cần review trước khi tăng độ khó.
            </p>
          </div>
          <Badge tone="mastery">{attempt.mode === "practice" ? "Practice mode" : "Test mode"}</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="flex flex-col gap-4 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <ProgressRing value={attempt.scorePct} label="Điểm attempt gần nhất" tone="mastery" />
            <div>
              <p className="text-base font-semibold text-ink-900">{attempt.documentTitle}</p>
              <p className="mt-1 text-sm text-ink-600">Nộp lúc {formatDateTime(attempt.submittedAt)} · {attempt.correctCount}/{attempt.totalCount} câu đúng</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button">Review {reviewCount} câu sai</Button>
            <Button variant="outline" type="button">
              Làm lại quiz
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink-900">Topic breakdown</p>
            <span className="text-sm text-ink-500">{Math.round(attempt.timeSpentSec / 60)} phút</span>
          </div>
          <BarChart
            data={topicData}
            summary="Topic breakdown cho lần làm bài gần nhất: Định thời CPU đạt 100%, Đồng bộ tiến trình đạt 50%."
          />
        </div>
      </CardBody>
    </Card>
  );
}

function ProcessingJobsCard({
  runningDocument,
  queuedDocument,
  failedDocument,
}: {
  runningDocument?: LearningDocument;
  queuedDocument?: LearningDocument;
  failedDocument?: LearningDocument;
}) {
  const runningJobs = jobs.filter((job) => job.status === "running").length;

  if (!runningDocument && !queuedDocument && !failedDocument) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Không có job nào đang chạy"
        description="Khi bạn upload tài liệu mới, trạng thái xử lý và pipeline minh bạch sẽ xuất hiện ở đây thay vì chỉ có spinner."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Processing jobs status</p>
            <CardTitle className="mt-1">Biết chính xác tài liệu nào đang ở bước nào</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Mọi AI job đều hiện step hiện tại, ETA và tình trạng recoverable failure để bạn không phải đoán.
            </p>
          </div>
          <Badge tone="brand">{runningJobs} running job</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {runningDocument?.processing ? (
          <div className="rounded-3xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-ink-900">{runningDocument.title}</p>
                  <TypeBadge type={runningDocument.type} />
                  <StatusPill status={runningDocument.status} />
                </div>
                <p className="text-sm text-ink-600">
                  Upload lúc {formatDateTime(runningDocument.uploadedAt)} · ETA còn khoảng {Math.ceil((runningDocument.processing.etaSec ?? 0) / 60)} phút
                </p>
              </div>
              <span className="text-sm font-semibold text-brand-700">{runningDocument.processing.percent}%</span>
            </div>
            <ProgressBar value={runningDocument.processing.percent} className="mt-4" />
            <div className="mt-4">
              <StepTimeline steps={runningDocument.processing.steps} />
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {queuedDocument ? (
            <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Hàng chờ kế tiếp</p>
                  <p className="mt-1 text-sm text-ink-600">{queuedDocument.title}</p>
                </div>
                <StatusPill status={queuedDocument.status} />
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-600">
                Tệp đã upload xong và đang chờ xác minh cuối trước khi bắt đầu pipeline xử lý.
              </p>
            </div>
          ) : null}

          {failedDocument?.processing ? (
            <div className="rounded-2xl border border-error-100 bg-error-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-error-700">Cần xử lý lại</p>
                  <p className="mt-1 text-sm font-medium text-ink-900">{failedDocument.title}</p>
                </div>
                <StatusPill status={failedDocument.status} />
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-700">
                {failedDocument.processing.failureReason}
              </p>
              <p className="mt-2 text-xs text-ink-500">
                Credits refunded: {failedDocument.processing.creditsRefunded ? "Có" : "Không"}
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-brand-100 bg-white px-4 py-3 text-sm text-ink-700">
          Processing có thể mất vài phút. Bạn có thể rời trang này; hệ thống sẽ giữ trạng thái và gửi thông báo khi tài liệu sẵn sàng.
        </div>
      </CardBody>
    </Card>
  );
}

function RecentlyReadyDocumentsCard({ documents }: { documents: LearningDocument[] }) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={Upload}
        title="Chưa có tài liệu sẵn sàng"
        description="Khi một tài liệu hoàn tất pipeline, nó sẽ xuất hiện ở đây cùng output có sẵn và gợi ý bước tiếp theo."
        action={<LinkButton href={routes.upload}>Upload tài liệu mới</LinkButton>}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-700">Recently ready documents</p>
          <CardTitle>Tài liệu mới sẵn sàng để học</CardTitle>
          <p className="text-sm leading-6 text-ink-600">
            Mỗi card cho biết loại tài liệu, output đã sinh, lần học gần nhất và bước nên làm tiếp theo.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <ul className="space-y-4">
          {documents.map((document) => (
            <li key={document.id} className="rounded-3xl border border-ink-100 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-ink-900">{document.title}</p>
                    <TypeBadge type={document.type} />
                    <StatusPill status={document.status} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {document.outputs.map((output) => (
                      <Badge key={output} tone="neutral">
                        {outputLabels[output]}
                      </Badge>
                    ))}
                  </div>
                </div>
                <span className="text-sm text-ink-500">
                  Học gần nhất: {document.lastStudiedAt ? formatDate(document.lastStudiedAt) : "Chưa học"}
                </span>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-600">Mastery</span>
                  <span className="font-medium text-ink-900">{document.masteryPct ?? 0}%</span>
                </div>
                <ProgressBar value={document.masteryPct ?? 0} tone="success" />
              </div>
              <p className="mt-3 text-sm text-ink-600">Bước tiếp theo: {getDocumentNextAction(document)}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function WeakTopicsCard({ topics }: { topics: WeakTopic[] }) {
  if (topics.length === 0) {
    return (
      <EmptyState
        icon={BrainCircuit}
        title="Chưa có weak topic"
        description="Sau khi có quiz results hoặc flashcard reviews, hệ thống sẽ gom bằng chứng để chỉ ra chỗ bạn còn mơ hồ."
      />
    );
  }

  const chartData = topics.map((topic) => ({
    label: topic.name,
    value: topic.masteryPct,
    tone: topic.masteryPct >= 70 ? "success" : topic.masteryPct >= 50 ? "warning" : "error",
  })) as { label: string; value: number; tone: "success" | "warning" | "error" }[];

  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-700">Weak topics</p>
          <CardTitle>Điểm yếu cần quay lại có bằng chứng rõ ràng</CardTitle>
          <p className="text-sm leading-6 text-ink-600">
            Không chỉ nói bạn yếu ở đâu, dashboard còn gắn mỗi topic với số câu sai và nguồn tài liệu liên quan.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <BarChart
          data={chartData}
          summary="Biểu đồ weak topics: Đồng bộ tiến trình 45%, Gradient descent 52%, UDP vs TCP 38%."
        />

        <ul className="space-y-3">
          {topics.map((topic) => (
            <li key={topic.id} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                    <Badge tone={topic.masteryPct < 50 ? "error" : "warning"}>{topic.masteryPct}% mastery</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-600">
                    Missed {topic.missedQuestions} câu · {topic.documentTitles.join(" · ")}
                  </p>
                </div>
                <Button variant="outline" type="button">
                  Review source
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function StudyProgressCard({ reviewCompletionPct }: { reviewCompletionPct: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Streak & progress</p>
            <CardTitle>Giữ nhịp học đều và nhìn thấy tiến bộ theo tuần</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Thay vì chỉ hiển thị chart đẹp, khu vực này cho biết streak, độ chính xác gần đây và mức hoàn thành review plan bằng ngôn ngữ dễ hành động.
            </p>
          </div>
          <Badge tone="mastery">{currentStreakDays} ngày liên tiếp</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <TrendChart
          data={weeklyAccuracyData}
          summary="Độ chính xác quiz tăng từ 48% đầu tuần lên 86% hôm nay."
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Streak" value={`${currentStreakDays} ngày`} tone="mastery" />
          <MetricTile label="Active days" value={`${activeStudyDays}/7`} tone="brand" />
          <MetricTile label="Review done" value={`${reviewCompletionPct}%`} tone="success" />
        </div>

        <div className="rounded-2xl border border-success-100 bg-success-50/70 p-4 text-sm leading-6 text-ink-700">
          Tuần này bạn đã tăng độ chính xác quiz lên <span className="font-semibold text-ink-900">38 điểm</span>. Nếu hoàn thành nốt review queue hôm nay, readiness cho course hiện tại sẽ vượt 80%.
        </div>
      </CardBody>
    </Card>
  );
}

function UsageWarningCard({
  creditRemainingPct,
  reviewCompletionPct,
}: {
  creditRemainingPct: number;
  reviewCompletionPct: number;
}) {
  const uploadUsagePct = Math.round((usage.uploadsUsed / usage.uploadsLimit) * 100);

  return (
    <Card className="border-warning-100 bg-warning-50/60">
      <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.45fr)] lg:items-center">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-warning-700">Usage warning</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">
                Credits đang gần ngưỡng, nên ưu tiên PDF/text trước video dài
              </h2>
            </div>
            <Badge tone="warning">{usage.planLabel}</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <UsageMeter
              label="Credits còn lại"
              helper={`${usage.creditsRemaining}/${usage.creditsTotal} credits · reset ${formatDate(usage.resetDate)}`}
              value={creditRemainingPct}
            />
            <UsageMeter
              label="Upload quota"
              helper={`${usage.uploadsUsed}/${usage.uploadsLimit} lượt upload`}
              value={uploadUsagePct}
            />
          </div>

          <div className="rounded-2xl border border-warning-100 bg-white/80 p-4 text-sm leading-6 text-ink-700">
            Với số dư hiện tại, bạn vẫn đủ để xử lý thêm một PDF trung bình hoặc tiếp tục review queue hôm nay. Video/audio dài nên để sau khi nạp thêm credits hoặc nâng cấp plan.
          </div>
        </div>

        <div className="rounded-3xl border border-warning-100 bg-white/85 p-5">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 text-warning-700" />
            <div className="space-y-2 text-sm text-ink-700">
              <p className="font-semibold text-ink-900">Điều nên làm ngay</p>
              <p>Hoàn thành {reviewCompletionPct}% review plan hiện tại trước khi tiêu thêm credits cho nội dung mới.</p>
              <div className="flex flex-wrap gap-3 pt-1">
                <LinkButton href={routes.upload} variant="outline">
                  Upload gọn hơn
                </LinkButton>
                <Button type="button">Xem breakdown usage</Button>
              </div>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "brand" | "success" | "review" | "mastery";
}) {
  const toneClass = {
    brand: "border-brand-100 bg-brand-50/70 text-brand-700",
    success: "border-success-100 bg-success-50/70 text-success-700",
    review: "border-review-100 bg-review-50/70 text-review-600",
    mastery: "border-mastery-100 bg-mastery-50/70 text-mastery-600",
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-ink-900">{value}</p>
    </div>
  );
}

function UsageMeter({
  label,
  helper,
  value,
}: {
  label: string;
  helper: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-warning-100 bg-white/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        <span className="text-sm font-medium text-warning-700">{value}%</span>
      </div>
      <ProgressBar value={value} tone="warning" className="mt-3" />
      <p className="mt-2 text-sm text-ink-600">{helper}</p>
    </div>
  );
}

function getLatestAttempt(): Attempt | undefined {
  const attemptsByDate = [...attempts].sort(
    (left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
  );

  return attemptsByDate[0];
}

function getDocumentNextAction(document: LearningDocument): string {
  if (document.outputs.includes("quiz") && (document.masteryPct ?? 0) < 70) {
    return "Làm lại quiz để kéo mastery vượt 70%.";
  }

  if (document.outputs.includes("flashcards")) {
    return "Ôn flashcards đến hạn để giữ nhịp nhớ dài hạn.";
  }

  if (document.outputs.includes("checkpoints")) {
    return "Xem lại checkpoint bị lỡ và trả lời lại ngay.";
  }

  return "Mở Tutor để hỏi lại phần bạn còn mơ hồ.";
}
