import Link from "next/link";
import { ArrowRight, CalendarClock, Clock3, Target, TrendingUp, TriangleAlert } from "lucide-react";
import { routes } from "@/lib/routes";
import {
  attempts,
  courses,
  documents,
  dueCardsToday,
  exams,
  formatDate,
  formatDateTime,
  studyTasks,
  videoCheckpoints,
  weakTopics,
} from "@/lib/mock-data";
import { BarChart, Badge, Card, CardBody, CardHeader, CardTitle, CitationSnippet, LinkButton, ProgressBar, ProgressRing } from "@/components/ui";

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: "brand" | "success" | "warning" | "mastery" | "review";
}

interface TimeDatum {
  readonly label: string;
  readonly minutes: number;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "brand",
}: MetricCardProps) {
  const toneClass = {
    brand: "bg-brand-50 text-brand-700",
    success: "bg-success-50 text-success-700",
    warning: "bg-warning-50 text-warning-700",
    mastery: "bg-mastery-50 text-mastery-600",
    review: "bg-review-50 text-review-600",
  }[tone];

  return (
    <Card>
      <CardBody className="space-y-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
          {label}
        </span>
        <div>
          <p className="text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
          <p className="mt-1 text-sm text-ink-600">{detail}</p>
        </div>
      </CardBody>
    </Card>
  );
}

function TimeTrend({ data }: { readonly data: readonly TimeDatum[] }) {
  const maxMinutes = Math.max(...data.map((item) => item.minutes), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
        {data.map((item) => {
          const height = Math.max(16, (item.minutes / maxMinutes) * 140);
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-xs font-medium text-ink-800">{item.minutes}m</span>
              <div className="flex h-36 items-end">
                <div
                  className="w-8 rounded-t-xl bg-brand-500"
                  style={{ height }}
                  aria-hidden
                />
              </div>
              <span className="text-center text-xs text-ink-500">{item.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-sm leading-6 text-ink-600">
        Tuần này bạn đã học tổng cộng {formatMinutes(getTotalMinutes(data))}. Phiên dài nhất rơi vào {getPeakDay(data)},
        cho thấy bạn đang dồn thời gian cho các buổi ôn tập trước kỳ thi thay vì học dàn trải.
      </p>
    </div>
  );
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} phút`;
  }

  return `${hours} giờ ${minutes} phút`;
}

function getTotalMinutes(data: readonly TimeDatum[]): number {
  return data.reduce((total, item) => total + item.minutes, 0);
}

function getPeakDay(data: readonly TimeDatum[]): string {
  const peak = data.reduce((best, item) => (item.minutes > best.minutes ? item : best), data[0]);
  return `${peak.label} (${peak.minutes} phút)`;
}

function calculateOverallMastery(): number {
  const masteredDocuments = documents.filter(
    (documentItem) => typeof documentItem.masteryPct === "number",
  );

  const totalMastery = masteredDocuments.reduce(
    (total, documentItem) => total + (documentItem.masteryPct ?? 0),
    0,
  );

  return Math.round(totalMastery / masteredDocuments.length);
}

function buildAccuracyTrend() {
  return [58, 64, 68, attempts[0]?.scorePct ?? 72].map((value, index) => ({
    label: `Lần ${index + 1}`,
    value,
    tone: "mastery" as const,
  }));
}

function buildStudyTimeTrend(): readonly TimeDatum[] {
  return [
    { label: "T2", minutes: 35 },
    { label: "T3", minutes: 48 },
    { label: "T4", minutes: 22 },
    { label: "T5", minutes: 44 },
    { label: "T6", minutes: 30 },
    { label: "T7", minutes: 58 },
    { label: "CN", minutes: 40 },
  ] as const;
}

function buildWeakTopicChart(): Array<{
  label: string;
  value: number;
  tone: "error" | "warning";
}> {
  return weakTopics.map((topic) => ({
    label: topic.name,
    value: topic.masteryPct,
    tone: topic.masteryPct < 45 ? "error" : "warning",
  }));
}

function buildStrongTopicChart(): Array<{
  label: string;
  value: number;
  tone: "success";
}> {
  const attemptTopics = attempts.flatMap((attempt) =>
    attempt.topicBreakdown
      .map((topic) => ({
        label: topic.topic,
        value: Math.round((topic.correct / topic.total) * 100),
      }))
      .filter((topic) => topic.value >= 80),
  );

  const checkpointTopics = videoCheckpoints
    .filter((checkpoint) => checkpoint.completed)
    .map((checkpoint) => ({
      label: checkpoint.question.topic,
      value: 88,
    }));

  const uniqueTopics = [...attemptTopics, ...checkpointTopics].filter(
    (topic, index, items) => items.findIndex((item) => item.label === topic.label) === index,
  );

  return uniqueTopics.slice(0, 3).map((topic) => ({
    ...topic,
    tone: "success" as const,
  }));
}

function buildConsistencyChart(): Array<{
  label: string;
  value: number;
  tone: "warning" | "review";
}> {
  return [100, 85, 0, 90, 70, 100, 90].map((value, index) => ({
    label: `Ngày ${index + 1}`,
    value,
    tone: value === 0 ? "warning" : "review",
  }));
}

function getLowMasteryDocuments() {
  return documents
    .filter(
      (documentItem) =>
        documentItem.status === "ready" && typeof documentItem.masteryPct === "number",
    )
    .sort(
      (left, right) => (left.masteryPct ?? 0) - (right.masteryPct ?? 0),
    )
    .slice(0, 3);
}

function calculateReadinessDelta(): number {
  const exam = exams[0];
  return exam.targetScorePct - exam.readinessPct;
}

function calculateStreakDays(): number {
  return buildConsistencyChart().filter((item) => item.value >= 70).length;
}

export function AnalyticsDashboard() {
  const overallMastery = calculateOverallMastery();
  const readinessGap = calculateReadinessDelta();
  const weeklyTasksDone = studyTasks.filter((task) => task.done).length;
  const totalStudyTasks = studyTasks.length;
  const streakDays = calculateStreakDays();
  const studyTimeTrend = buildStudyTimeTrend();
  const accuracyTrend = buildAccuracyTrend();
  const weakTopicChart = buildWeakTopicChart();
  const strongTopicChart = buildStrongTopicChart();
  const consistencyChart = buildConsistencyChart();
  const lowMasteryDocuments = getLowMasteryDocuments();

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Overall mastery"
          value={`${overallMastery}%`}
          detail="Trung bình trên tất cả tài liệu đã có attempt hoặc review."
          tone="mastery"
        />
        <MetricCard
          label="Exam readiness"
          value={`${exams[0].readinessPct}%`}
          detail={`Bạn còn thiếu ${readinessGap} điểm phần trăm để chạm mục tiêu ${exams[0].targetScorePct}%.`}
          tone="brand"
        />
        <MetricCard
          label="Review consistency"
          value={`${streakDays}/7 ngày`}
          detail="Bạn giữ được nhịp review ổn định trong hầu hết các ngày gần đây."
          tone="review"
        />
        <MetricCard
          label="Tasks completed"
          value={`${weeklyTasksDone}/${totalStudyTasks}`}
          detail="Một task đã hoàn tất, ba task còn lại đều gắn với điểm yếu hoặc review đến hạn."
          tone="success"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Mastery overview</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Mức tự tin hiện tại trên các course bạn đang học.
              </p>
            </div>
            <ProgressRing
              value={overallMastery}
              tone="mastery"
              label="Overall mastery"
            />
          </CardHeader>
          <CardBody className="space-y-4">
            {courses.map((course) => (
              <div key={course.id} className="space-y-2 rounded-2xl border border-ink-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{course.name}</p>
                    <p className="text-sm text-ink-500">{course.subject}</p>
                  </div>
                  <Badge tone="mastery">{course.masteryPct}% mastery</Badge>
                </div>
                <ProgressBar value={course.masteryPct} tone="mastery" />
                <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
                  <span>{course.dueReviews} review đến hạn</span>
                  {course.deadline ? <span>Deadline {formatDate(course.deadline)}</span> : null}
                  {course.lastStudiedAt ? <span>Học gần nhất {formatDateTime(course.lastStudiedAt)}</span> : null}
                </div>
              </div>
            ))}
            <p className="text-sm leading-6 text-ink-600">
              Course Hệ điều hành đang là trọng tâm: deadline gần hơn, độ phủ tài liệu nhiều hơn và vẫn còn khoảng cách lớn tới mục tiêu thi.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents needing review</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Những tài liệu có mastery thấp hoặc đang tạo nhiều câu sai lặp lại.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {lowMasteryDocuments.map((documentItem) => (
              <Link
                key={documentItem.id}
                href={routes.document(documentItem.id)}
                className="block rounded-2xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{documentItem.title}</p>
                    <p className="mt-1 text-sm text-ink-500">
                      {documentItem.outputs.join(" · ") || "Chưa có output"}
                    </p>
                  </div>
                  <Badge tone={documentItem.masteryPct && documentItem.masteryPct < 50 ? "error" : "warning"}>
                    {documentItem.masteryPct}%
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-ink-600">
                  {documentItem.weakTopics?.join(" · ") ?? "Cần thêm attempt để xác định điểm yếu."}
                </p>
              </Link>
            ))}
            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm text-warning-700">
              Tài liệu đang xử lý mới nhất là “{documents[3].title}”. Khi sẵn sàng, hãy thêm nó vào plan để tăng độ phủ cho kỳ thi.
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weekly study time</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Thời gian học thực tế trong 7 ngày gần nhất.
            </p>
          </CardHeader>
          <CardBody>
            <TimeTrend data={studyTimeTrend} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quiz accuracy trend</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Diễn biến độ chính xác qua các attempt gần đây.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <BarChart
              data={accuracyTrend}
              summary="Độ chính xác quiz đã tăng dần từ 58% lên 72% trong bốn lần luyện gần nhất."
            />
            <p className="text-sm leading-6 text-ink-600">
              Accuracy đang cải thiện đều, tăng 14 điểm phần trăm qua bốn lần luyện. Mức tăng chủ yếu đến từ nhóm câu hỏi về định thời CPU, trong khi phần đồng bộ vẫn còn kéo điểm xuống.
            </p>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Weak topics</CardTitle>
              <p className="mt-1 text-sm text-ink-600">
                Ưu tiên các chủ đề dưới 55% mastery để kéo readiness lên nhanh nhất.
              </p>
            </div>
            <LinkButton href={routes.studyPlan} variant="outline" size="sm">
              Open study plan
            </LinkButton>
          </CardHeader>
          <CardBody className="space-y-4">
            <BarChart
              data={weakTopicChart}
              summary="Ba chủ đề yếu nhất hiện là UDP vs TCP, Đồng bộ tiến trình và Gradient descent."
            />
            <p className="text-sm leading-6 text-ink-600">
              Chủ đề yếu nhất là UDP vs TCP ở mức 38% mastery. Nếu bạn sửa được hai cụm lỗi dưới 50%, readiness dự kiến sẽ tăng nhanh hơn so với việc làm thêm quiz ngẫu nhiên.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {weakTopics.map((topic) => (
                <Link
                  key={topic.id}
                  href={routes.weakTopic(topic.id)}
                  className="rounded-2xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                  <p className="mt-1 text-sm text-ink-500">{topic.missedQuestions} câu sai gần đây</p>
                  <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700">
                    Xem bằng chứng <ArrowRight className="h-4 w-4" />
                  </p>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Strong topics</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Các vùng kiến thức bạn có thể giữ nhịp bằng review ngắn thay vì học lại từ đầu.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <BarChart
              data={strongTopicChart}
              summary="Định thời CPU và TCP là hai vùng đang ổn định nhất trong dữ liệu hiện có."
            />
            <p className="text-sm leading-6 text-ink-600">
              Định thời CPU đang giữ mức ổn định cao nhất với chuỗi trả lời đúng trọn vẹn. Đây là nhóm chủ đề chỉ cần review duy trì, không cần chiếm quá nhiều thời gian trong plan hôm nay.
            </p>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Review consistency</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Mức hoàn thành review mỗi ngày, tính theo tỷ lệ task đã lên lịch.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <BarChart
              data={consistencyChart}
              summary="Bạn giữ nhịp review ở 6 trên 7 ngày, với một ngày bị đứt nhịp hoàn toàn ở giữa tuần."
            />
            <p className="text-sm leading-6 text-ink-600">
              Nhịp review nhìn chung khá bền, nhưng ngày bị bỏ lỡ hoàn toàn khiến số card overdue tăng lên. Duy trì thêm một phiên review 10–15 phút vào giữa tuần sẽ giúp queue ổn định hơn.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mistake patterns</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Bằng chứng cụ thể để tránh luyện sai chỗ.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 text-warning-700" />
                <div>
                  <p className="text-sm font-semibold text-warning-800">Khó ở câu hỏi giải thích cơ chế</p>
                  <p className="mt-1 text-sm leading-6 text-warning-800/90">
                    Lỗi gần nhất nằm ở câu hỏi hard về wait()/signal(), cho thấy bạn nhớ từ khóa nhưng chưa chắc cơ chế chặn và đánh thức tiến trình.
                  </p>
                </div>
              </div>
            </div>
            <CitationSnippet citation={weakTopics[0].citations[0]} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Target className="h-4 w-4 text-brand-600" />
                  Next best action
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Ôn lại trích dẫn về semaphore rồi làm lại nhóm câu sai trước khi mở practice exam.
                </p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Clock3 className="h-4 w-4 text-review-600" />
                  Estimated effort
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Khoảng 15–20 phút để kéo nhóm Đồng bộ tiến trình từ 45% lên vùng an toàn đầu tiên.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming exam readiness</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Khung nhìn deadline để quyết định nên review hay luyện đề.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink-100 p-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">{exams[0].name}</p>
                <p className="mt-1 text-sm text-ink-500">Thi ngày {formatDate(exams[0].date)}</p>
              </div>
              <ProgressRing value={exams[0].readinessPct} tone="brand" label="Exam readiness" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Target</p>
                <p className="mt-2 text-xl font-semibold text-ink-900">{exams[0].targetScorePct}%</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Due reviews</p>
                <p className="mt-2 text-xl font-semibold text-ink-900">{dueCardsToday.length}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <p className="text-sm font-medium text-ink-500">Priority topics</p>
                <p className="mt-2 text-xl font-semibold text-ink-900">{weakTopics.length}</p>
              </div>
            </div>
            <p className="text-sm leading-6 text-ink-600">
              Với readiness hiện tại, bạn nên ưu tiên review có dẫn chứng trong 3–4 ngày tới, sau đó mới tăng tỷ trọng luyện đề timed mode để đo lại tiến bộ.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Đi thẳng vào hành động có tác động cao nhất cho hôm nay.
            </p>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <LinkButton href={routes.studyPlan} className="justify-between">
              Mở study plan
              <CalendarClock className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.practiceExam(exams[0].id)} variant="secondary" className="justify-between">
              Practice exam
              <TrendingUp className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.weakTopic(weakTopics[0].id)} variant="outline" className="justify-between">
              Review weak topic
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.billing} variant="outline" className="justify-between">
              Check credits
              <Clock3 className="h-4 w-4" />
            </LinkButton>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
