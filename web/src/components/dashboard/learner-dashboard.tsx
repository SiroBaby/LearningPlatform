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
  quiz: "Bài kiểm tra",
  flashcards: "Thẻ ghi nhớ",
  tutor: "Trợ giảng",
  checkpoints: "Điểm dừng",
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
  flashcards: "Thẻ ghi nhớ",
  retry_quiz: "Làm lại bài kiểm tra",
  video_checkpoint: "Điểm dừng",
  read_source: "Xem lại tài liệu",
  ask_tutor: "Hỏi trợ giảng",
  practice_exam: "Luyện kiểm tra",
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
          Bài kiểm tra gần nhất: <span className="font-medium text-ink-700">{latestQuiz.title.replace(/^Quiz\b/i, "Bài kiểm tra")}</span> với {latestQuiz.questionCount} câu.
          Đây là dữ liệu minh họa; các nút bên ngoài trang này chỉ mô phỏng bước học tiếp theo.
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
            <Badge tone="brand">Việc nên làm hôm nay</Badge>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
                Tiếp tục ôn nhớ chủ động hôm nay
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600 sm:text-base">
                Tải tài liệu mới hoặc quay lại phần ôn tập ưu tiên. Hãy hoàn thành phần cần ôn trước khi mở bài kiểm tra mới.
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
                  Môn học: {currentCourse.name}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <LinkButton href={routes.upload}>
              Tải tài liệu mới <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <Button variant="secondary" type="button">
              Tiếp tục ôn tập
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile label="Đến hạn hôm nay" value={`${dueCount} mục`} tone="review" />
            <MetricTile label="Tài liệu sẵn sàng" value={`${readyCount} tài liệu`} tone="success" />
            <MetricTile label="Hoàn thành kế hoạch" value={`${reviewCompletionPct}%`} tone="brand" />
          </div>
        </div>

        <div className="rounded-3xl border border-brand-100 bg-white/90 p-5 lg:w-64">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-start">
            <ProgressRing value={todayReadinessPct} label="Mức sẵn sàng hôm nay" tone="brand" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink-900">Mức sẵn sàng hôm nay</p>
              <p className="text-sm leading-6 text-ink-600">
                Bạn đã duy trì chuỗi ngày học <span className="font-semibold text-ink-900">{currentStreakDays} ngày</span> và còn một chủ đề cần ôn trước khi làm bài kiểm tra mới.
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
        title="Chưa có gợi ý tiếp theo"
        description="Khi có mục đến hạn hoặc câu sai gần đây, gợi ý ôn tập sẽ xuất hiện ở đây."
        action={<LinkButton href={routes.upload}>Tải tài liệu đầu tiên</LinkButton>}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Gợi ý tiếp theo</p>
            <CardTitle className="mt-1">Ôn lại {weakTopic.name}</CardTitle>
          </div>
          <Badge tone="warning">Ưu tiên cao</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4 text-sm leading-6 text-ink-700">
          Bạn đã sai <span className="font-semibold text-ink-900">{weakTopic.missedQuestions} câu</span> thuộc chủ đề này. Hãy xem lại tài liệu rồi làm lại ngay khi kiến thức còn mới.
        </div>

        <CitationSnippet citation={weakTopic.citations[0]} />

        <ol className="space-y-2 text-sm text-ink-600">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">1</span>
            Đọc lại đoạn trích và nhắc lại ý chính bằng lời của bạn.
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">2</span>
            Làm lại các câu sai liên quan đến {weakTopic.name} trước khi mở bài kiểm tra mới.
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">3</span>
            Nếu vẫn mơ hồ, dùng trợ giảng để xin ví dụ và so sánh khái niệm.
          </li>
        </ol>

        <div className="flex flex-wrap gap-3">
          <Button type="button">Ôn chủ đề này ngay</Button>
          <Button variant="outline" type="button">
            Xem câu sai
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
        title="Hôm nay chưa có mục cần ôn"
        description="Khi có thẻ ghi nhớ, câu sai hoặc điểm dừng cần xem lại, danh sách ôn tập sẽ xuất hiện ở đây cùng thời lượng ước tính."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Ôn tập hôm nay</p>
            <CardTitle className="mt-1">Những gì bạn nên xử lý trước</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Danh sách này ưu tiên thẻ quá hạn, câu sai gần đây, điểm dừng video và nội dung cần hỏi trợ giảng.
            </p>
          </div>
          <Badge tone="review">{totalMinutes} phút</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-2xl border border-review-100 bg-review-50/60 px-4 py-3 text-sm text-ink-700">
          <span className="font-semibold text-ink-900">{dueCardsToday.length} thẻ ghi nhớ</span> đã đến hạn hôm nay. Hoàn thành chúng trước để duy trì nhịp ôn tập.
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
                      {task.done ? "Đã xong" : taskLabelMap[task.type]}
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
        title="Chưa có bài làm gần đây"
        description="Làm bài kiểm tra đầu tiên để trang học tập bắt đầu theo dõi tiến độ, điểm yếu và phần nên ôn tiếp theo."
        action={<LinkButton href={routes.upload}>Tạo bài kiểm tra từ tài liệu</LinkButton>}
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
            <p className="text-sm font-semibold text-brand-700">Bài làm gần nhất</p>
            <CardTitle className="mt-1">Tiếp tục từ lần làm bài gần nhất</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Điểm gần nhất của bạn đã đủ tốt để tiếp tục, nhưng vẫn còn một cụm lỗi nhỏ cần ôn trước khi tăng độ khó.
            </p>
          </div>
          <Badge tone="mastery">{attempt.mode === "practice" ? "Luyện tập" : "Kiểm tra"}</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="flex flex-col gap-4 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <ProgressRing value={attempt.scorePct} label="Điểm bài làm gần nhất" tone="mastery" />
            <div>
              <p className="text-base font-semibold text-ink-900">{attempt.documentTitle}</p>
              <p className="mt-1 text-sm text-ink-600">Nộp lúc {formatDateTime(attempt.submittedAt)} · {attempt.correctCount}/{attempt.totalCount} câu đúng</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button">Ôn {reviewCount} câu sai</Button>
            <Button variant="outline" type="button">
              Làm lại bài kiểm tra
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink-900">Kết quả theo chủ đề</p>
            <span className="text-sm text-ink-500">{Math.round(attempt.timeSpentSec / 60)} phút</span>
          </div>
          <BarChart
            data={topicData}
            summary="Kết quả theo chủ đề của bài làm gần nhất: Định thời CPU đạt 100%, Đồng bộ tiến trình đạt 50%."
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
        title="Không có tài liệu đang xử lý"
        description="Khi bạn tải tài liệu mới, tiến độ xử lý sẽ xuất hiện ở đây để bạn biết tài liệu đang ở bước nào."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-700">Trạng thái xử lý tài liệu</p>
            <CardTitle className="mt-1">Biết chính xác tài liệu nào đang ở bước nào</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Mỗi tài liệu đều hiển thị bước hiện tại và cách xử lý nếu có lỗi để bạn không phải đoán.
            </p>
          </div>
          <Badge tone="brand">{runningJobs} tài liệu đang xử lý</Badge>
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
                  Tải lên lúc {formatDateTime(runningDocument.uploadedAt)} · Còn khoảng {Math.ceil((runningDocument.processing.etaSec ?? 0) / 60)} phút
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
                Tệp đã tải lên xong và đang chờ xác minh trước khi bắt đầu xử lý.
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
                Đã hoàn lượt dùng: {failedDocument.processing.creditsRefunded ? "Có" : "Không"}
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-brand-100 bg-white px-4 py-3 text-sm text-ink-700">
          Việc xử lý có thể mất vài phút. Bạn có thể rời trang này; hệ thống sẽ giữ trạng thái và báo khi tài liệu sẵn sàng.
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
        description="Khi một tài liệu xử lý xong, tài liệu sẽ xuất hiện ở đây cùng nội dung đã tạo và gợi ý bước tiếp theo."
        action={<LinkButton href={routes.upload}>Tải tài liệu mới</LinkButton>}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-700">Tài liệu vừa sẵn sàng</p>
          <CardTitle>Tài liệu mới sẵn sàng để học</CardTitle>
          <p className="text-sm leading-6 text-ink-600">
            Mỗi mục cho biết loại tài liệu, nội dung đã tạo, lần học gần nhất và bước nên làm tiếp theo.
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
                  <span className="text-ink-600">Mức độ nắm vững</span>
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
        title="Chưa có chủ đề cần ôn"
        description="Sau khi có kết quả bài kiểm tra hoặc lượt ôn thẻ ghi nhớ, hệ thống sẽ chỉ ra chỗ bạn còn mơ hồ."
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
          <p className="text-sm font-semibold text-brand-700">Chủ đề cần ôn thêm</p>
          <CardTitle>Điểm yếu cần quay lại có bằng chứng rõ ràng</CardTitle>
          <p className="text-sm leading-6 text-ink-600">
            Không chỉ nói bạn yếu ở đâu, trang học tập còn gắn mỗi chủ đề với số câu sai và nguồn tài liệu liên quan.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <BarChart
          data={chartData}
          summary="Biểu đồ các chủ đề cần ôn: Đồng bộ tiến trình 45%, Gradient descent 52%, UDP vs TCP 38%."
        />

        <ul className="space-y-3">
          {topics.map((topic) => (
            <li key={topic.id} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                    <Badge tone={topic.masteryPct < 50 ? "error" : "warning"}>{topic.masteryPct}% nắm vững</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-600">
                    Sai {topic.missedQuestions} câu · {topic.documentTitles.join(" · ")}
                  </p>
                </div>
                <Button variant="outline" type="button">
                  Xem lại tài liệu
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
          <p className="text-sm font-semibold text-brand-700">Chuỗi ngày học & tiến bộ</p>
            <CardTitle>Giữ nhịp học đều và nhìn thấy tiến bộ theo tuần</CardTitle>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Khu vực này cho biết chuỗi ngày học, độ chính xác gần đây và mức hoàn thành kế hoạch ôn tập.
            </p>
          </div>
          <Badge tone="mastery">{currentStreakDays} ngày liên tiếp</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <TrendChart
          data={weeklyAccuracyData}
          summary="Độ chính xác bài kiểm tra tăng từ 48% đầu tuần lên 86% hôm nay."
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Chuỗi ngày học" value={`${currentStreakDays} ngày`} tone="mastery" />
          <MetricTile label="Ngày đã học" value={`${activeStudyDays}/7`} tone="brand" />
          <MetricTile label="Đã ôn tập" value={`${reviewCompletionPct}%`} tone="success" />
        </div>

        <div className="rounded-2xl border border-success-100 bg-success-50/70 p-4 text-sm leading-6 text-ink-700">
          Tuần này bạn đã tăng độ chính xác bài kiểm tra lên <span className="font-semibold text-ink-900">38 điểm</span>. Nếu hoàn thành nốt phần ôn tập hôm nay, mức sẵn sàng cho môn học hiện tại sẽ vượt 80%.
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
              <p className="text-sm font-semibold text-warning-700">Mức sử dụng</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">
                Lượt dùng sắp chạm ngưỡng, nên ưu tiên PDF hoặc văn bản trước video dài
              </h2>
            </div>
            <Badge tone="warning">{usage.planLabel}</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <UsageMeter
              label="Lượt dùng còn lại"
              helper={`${usage.creditsRemaining}/${usage.creditsTotal} lượt · đặt lại ${formatDate(usage.resetDate)}`}
              value={creditRemainingPct}
            />
            <UsageMeter
              label="Lượt tải lên"
              helper={`${usage.uploadsUsed}/${usage.uploadsLimit} lượt tải lên`}
              value={uploadUsagePct}
            />
          </div>

          <div className="rounded-2xl border border-warning-100 bg-white/80 p-4 text-sm leading-6 text-ink-700">
            Với số dư hiện tại, bạn vẫn đủ để xử lý thêm một PDF trung bình hoặc tiếp tục ôn tập hôm nay. Video hoặc audio dài nên để sau khi có thêm lượt dùng hoặc nâng cấp gói.
          </div>
        </div>

        <div className="rounded-3xl border border-warning-100 bg-white/85 p-5">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 text-warning-700" />
            <div className="space-y-2 text-sm text-ink-700">
              <p className="font-semibold text-ink-900">Điều nên làm ngay</p>
              <p>Hoàn thành {reviewCompletionPct}% kế hoạch ôn tập hiện tại trước khi dùng thêm lượt dùng cho nội dung mới.</p>
              <div className="flex flex-wrap gap-3 pt-1">
                <LinkButton href={routes.upload} variant="outline">
                  Tải tệp nhẹ hơn
                </LinkButton>
                <Button type="button">Xem chi tiết mức sử dụng</Button>
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
    return "Làm lại bài kiểm tra để nâng mức nắm vững lên trên 70%.";
  }

  if (document.outputs.includes("flashcards")) {
    return "Ôn thẻ ghi nhớ đến hạn để duy trì kiến thức dài hạn.";
  }

  if (document.outputs.includes("checkpoints")) {
    return "Xem lại điểm dừng đã lỡ và trả lời lại ngay.";
  }

  return "Mở trợ giảng để hỏi lại phần bạn còn mơ hồ.";
}
