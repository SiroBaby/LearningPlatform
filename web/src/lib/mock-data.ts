import { formatVietnameseDate, formatVietnameseShortDateTime } from "./date-time";
import type {
  Attempt,
  Citation,
  Classroom,
  Course,
  Exam,
  Flashcard,
  FlashcardDeck,
  Job,
  LearningDocument,
  ProcessingStep,
  Question,
  Quiz,
  UsageState,
  VideoCheckpoint,
  WeakTopic,
  AppNotification,
  Assignment,
  Invoice,
  StudyTask,
} from "./types";

/* ---------- Processing pipeline template ---------- */

export function buildSteps(
  reached: number,
  failedAt?: number,
): ProcessingStep[] {
  const defs: { key: ProcessingStep["key"]; label: string }[] = [
    { key: "verified", label: "Đã xác minh tệp" },
    { key: "extract", label: "Trích xuất nội dung" },
    { key: "chunk", label: "Chia nhỏ nội dung" },
    { key: "generate", label: "Sinh câu hỏi" },
    { key: "validate", label: "Kiểm tra đầu ra" },
    { key: "build", label: "Tạo bài kiểm tra / thẻ ghi nhớ" },
    { key: "ready", label: "Sẵn sàng" },
  ];
  return defs.map((d, i) => ({
    ...d,
    status:
      failedAt === i
        ? "failed"
        : i < reached
          ? "done"
          : i === reached
            ? "running"
            : "pending",
  }));
}

/* ---------- Citations ---------- */

export const citations: Record<string, Citation> = {
  osContextSwitch: {
    chunkId: "chunk_os_012",
    locator: { kind: "page", page: 12 },
    snippet:
      "Context switch requires saving and restoring process state, which introduces CPU overhead because no useful work is done during the switch.",
    documentId: "doc_os_ch3",
    documentTitle: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
  },
  osScheduling: {
    chunkId: "chunk_os_018",
    locator: { kind: "page", page: 18 },
    snippet:
      "Round-Robin cấp cho mỗi tiến trình một lượng thời gian (time quantum) cố định, sau đó chuyển sang tiến trình kế tiếp trong hàng đợi.",
    documentId: "doc_os_ch3",
    documentTitle: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
  },
  osSync: {
    chunkId: "chunk_os_024",
    locator: { kind: "page", page: 24 },
    snippet:
      "Semaphore là biến đếm dùng để đồng bộ tiến trình; thao tác wait() giảm giá trị, signal() tăng giá trị một cách nguyên tử.",
    documentId: "doc_os_ch3",
    documentTitle: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
  },
  mlGradient: {
    chunkId: "chunk_ml_007",
    locator: { kind: "page", page: 7 },
    snippet:
      "Gradient descent updates parameters in the opposite direction of the gradient of the loss function, scaled by the learning rate.",
    documentId: "doc_ml_intro",
    documentTitle: "Machine Learning Foundations — Optimization.pdf",
  },
  videoTcp: {
    chunkId: "chunk_net_115",
    locator: { kind: "time", startSec: 312, endSec: 358 },
    snippet:
      "TCP dùng cơ chế bắt tay ba bước (three-way handshake): SYN, SYN-ACK, ACK để thiết lập kết nối tin cậy trước khi truyền dữ liệu.",
    documentId: "doc_net_video",
    documentTitle: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
  },
  videoUdp: {
    chunkId: "chunk_net_140",
    locator: { kind: "time", startSec: 640, endSec: 690 },
    snippet:
      "UDP là giao thức không kết nối, không đảm bảo thứ tự hay độ tin cậy, đổi lại độ trễ thấp — phù hợp cho streaming và game.",
    documentId: "doc_net_video",
    documentTitle: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
  },
};

/* ---------- Documents ---------- */

export const documents: LearningDocument[] = [
  {
    id: "doc_os_ch3",
    title: "Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf",
    type: "pdf",
    status: "ready",
    uploadedAt: "2026-07-02T09:12:00Z",
    lastStudiedAt: "2026-07-07T21:30:00Z",
    courseId: "course_os",
    tags: ["Hệ điều hành", "Ôn thi cuối kỳ"],
    pages: 42,
    outputs: ["quiz", "flashcards", "tutor"],
    masteryPct: 68,
    lastAttemptScorePct: 72,
    weakTopics: ["Đồng bộ tiến trình", "Định thời CPU"],
  },
  {
    id: "doc_ml_intro",
    title: "Machine Learning Foundations — Optimization.pdf",
    type: "pdf",
    status: "ready",
    uploadedAt: "2026-06-28T14:05:00Z",
    lastStudiedAt: "2026-07-05T10:00:00Z",
    courseId: "course_ml",
    tags: ["Machine Learning", "Toán"],
    pages: 30,
    outputs: ["quiz", "flashcards", "tutor"],
    masteryPct: 54,
    lastAttemptScorePct: 60,
    weakTopics: ["Gradient descent"],
  },
  {
    id: "doc_net_video",
    title: "Bài giảng Mạng máy tính — Giao thức TCP.mp4",
    type: "video",
    status: "ready",
    uploadedAt: "2026-07-01T08:00:00Z",
    lastStudiedAt: "2026-07-06T19:00:00Z",
    courseId: "course_os",
    tags: ["Mạng máy tính"],
    durationSec: 1420,
    outputs: ["checkpoints", "tutor", "quiz"],
    masteryPct: 41,
    weakTopics: ["UDP vs TCP"],
  },
  {
    id: "doc_db_ch5",
    title: "Cơ sở dữ liệu — Chương 5: Chuẩn hóa quan hệ.pdf",
    type: "pdf",
    status: "processing",
    uploadedAt: "2026-07-08T07:45:00Z",
    tags: ["Cơ sở dữ liệu", "Ôn thi cuối kỳ"],
    pages: 26,
    outputs: [],
    processing: {
      percent: 58,
      etaSec: 95,
      steps: buildSteps(3),
    },
  },
  {
    id: "doc_calc_notes",
    title: "Ghi chú Giải tích — Tích phân từng phần.txt",
    type: "text",
    status: "failed",
    uploadedAt: "2026-07-07T16:20:00Z",
    tags: ["Giải tích"],
    outputs: [],
    processing: {
      percent: 40,
      steps: buildSteps(2, 2),
      failureReason:
        "Không trích xuất được đủ nội dung có ý nghĩa từ tệp. Văn bản quá ngắn để sinh câu hỏi có chất lượng.",
      creditsRefunded: true,
    },
  },
  {
    id: "doc_hist_audio",
    title: "Podcast Lịch sử Việt Nam — Cách mạng tháng Tám.mp3",
    type: "audio",
    status: "uploaded",
    uploadedAt: "2026-07-08T10:30:00Z",
    tags: ["Lịch sử"],
    durationSec: 2700,
    outputs: [],
  },
];

export function getDocument(id: string): LearningDocument | undefined {
  return documents.find((d) => d.id === id);
}

/* ---------- Questions & Quizzes ---------- */

const osQuestions: Question[] = [
  {
    id: "q_os_1",
    ordinal: 1,
    stem: "Vì sao context switching tạo overhead cho hệ thống?",
    options: [
      { id: "a", text: "Vì CPU phải lưu và khôi phục trạng thái tiến trình mà không làm việc hữu ích" },
      { id: "b", text: "Vì tiến trình mới luôn cần nhiều bộ nhớ hơn" },
      { id: "c", text: "Vì hệ điều hành phải nạp lại toàn bộ chương trình từ đĩa" },
      { id: "d", text: "Vì mọi context switch đều gây ra lỗi trang (page fault)" },
    ],
    correctOptionId: "a",
    explanation:
      "Context switch buộc CPU lưu trạng thái tiến trình đang chạy và khôi phục trạng thái tiến trình kế tiếp. Trong khoảng thời gian đó CPU không thực thi công việc hữu ích, tạo ra overhead.",
    citation: citations.osContextSwitch,
    difficulty: "medium",
    topic: "Định thời CPU",
  },
  {
    id: "q_os_2",
    ordinal: 2,
    stem: "Thuật toán Round-Robin định thời CPU dựa trên yếu tố nào?",
    options: [
      { id: "a", text: "Độ ưu tiên tĩnh của mỗi tiến trình" },
      { id: "b", text: "Một lượng thời gian (time quantum) cố định cho mỗi tiến trình" },
      { id: "c", text: "Thời gian còn lại ngắn nhất" },
      { id: "d", text: "Thứ tự đến của tiến trình, không ngắt" },
    ],
    correctOptionId: "b",
    explanation:
      "Round-Robin cấp cho mỗi tiến trình một time quantum cố định rồi chuyển sang tiến trình kế tiếp, đảm bảo tính công bằng.",
    citation: citations.osScheduling,
    difficulty: "easy",
    topic: "Định thời CPU",
  },
  {
    id: "q_os_3",
    ordinal: 3,
    stem: "Thao tác wait() trên một semaphore làm gì?",
    options: [
      { id: "a", text: "Tăng giá trị semaphore lên 1" },
      { id: "b", text: "Đặt lại semaphore về 0" },
      { id: "c", text: "Giảm giá trị semaphore một cách nguyên tử, có thể chặn tiến trình" },
      { id: "d", text: "Xóa semaphore khỏi bộ nhớ" },
    ],
    correctOptionId: "c",
    explanation:
      "wait() (hay P) giảm giá trị semaphore một cách nguyên tử; nếu giá trị < 0 tiến trình bị chặn cho tới khi có signal().",
    citation: citations.osSync,
    difficulty: "hard",
    topic: "Đồng bộ tiến trình",
  },
  {
    id: "q_os_4",
    ordinal: 4,
    stem: "Deadlock KHÔNG thể xảy ra nếu thiếu điều kiện nào sau đây?",
    options: [
      { id: "a", text: "Loại trừ tương hỗ (mutual exclusion)" },
      { id: "b", text: "Giữ và chờ (hold and wait)" },
      { id: "c", text: "Chờ vòng tròn (circular wait)" },
      { id: "d", text: "Tất cả bốn điều kiện Coffman đều cần thiết" },
    ],
    correctOptionId: "d",
    explanation:
      "Deadlock cần đồng thời cả bốn điều kiện Coffman; phá vỡ bất kỳ điều kiện nào cũng ngăn được deadlock.",
    citation: citations.osSync,
    difficulty: "medium",
    topic: "Đồng bộ tiến trình",
  },
  {
    id: "q_os_5",
    ordinal: 5,
    stem: "Trạng thái nào của tiến trình cho biết nó đang chờ một sự kiện I/O?",
    options: [
      { id: "a", text: "Running" },
      { id: "b", text: "Ready" },
      { id: "c", text: "Blocked / Waiting" },
      { id: "d", text: "Terminated" },
    ],
    correctOptionId: "c",
    explanation:
      "Tiến trình ở trạng thái Blocked/Waiting khi chờ một sự kiện (thường là I/O) hoàn tất trước khi có thể tiếp tục.",
    citation: citations.osContextSwitch,
    difficulty: "easy",
    topic: "Định thời CPU",
  },
];

export const quizzes: Quiz[] = [
  {
    id: "quiz_os_ch3",
    documentId: "doc_os_ch3",
    documentTitle: documents[0].title,
    title: "Quiz Chương 3 — Quản lý tiến trình",
    questionCount: osQuestions.length,
    estimatedMinutes: 8,
    difficultyMix: { easy: 2, medium: 2, hard: 1 },
    coverageTopics: ["Định thời CPU", "Đồng bộ tiến trình", "Deadlock"],
    questions: osQuestions,
  },
];

export function getQuiz(id: string): Quiz | undefined {
  return quizzes.find((q) => q.id === id);
}

export function getQuizByDocument(docId: string): Quiz | undefined {
  return quizzes.find((q) => q.documentId === docId);
}

/* ---------- Attempts ---------- */

export const attempts: Attempt[] = [
  {
    id: "att_os_1",
    quizId: "quiz_os_ch3",
    documentTitle: documents[0].title,
    mode: "practice",
    submittedAt: "2026-07-07T21:40:00Z",
    scorePct: 72,
    correctCount: 4,
    totalCount: 5,
    timeSpentSec: 372,
    answers: [
      { questionId: "q_os_1", selectedOptionId: "a", correct: true },
      { questionId: "q_os_2", selectedOptionId: "b", correct: true },
      { questionId: "q_os_3", selectedOptionId: "a", correct: false },
      { questionId: "q_os_4", selectedOptionId: "d", correct: true },
      { questionId: "q_os_5", selectedOptionId: "c", correct: true },
    ],
    topicBreakdown: [
      { topic: "Định thời CPU", correct: 3, total: 3 },
      { topic: "Đồng bộ tiến trình", correct: 1, total: 2 },
    ],
  },
];

export function getAttempt(id: string): Attempt | undefined {
  return attempts.find((a) => a.id === id);
}

export function getAttemptsByQuiz(quizId: string): Attempt[] {
  return attempts.filter((a) => a.quizId === quizId);
}

/* ---------- Video checkpoints ---------- */

export const videoCheckpoints: VideoCheckpoint[] = [
  {
    id: "cp_1",
    documentId: "doc_net_video",
    atSec: 358,
    completed: true,
    question: {
      id: "q_cp_1",
      ordinal: 1,
      stem: "TCP thiết lập kết nối bằng cơ chế nào?",
      options: [
        { id: "a", text: "Bắt tay hai bước: SYN, ACK" },
        { id: "b", text: "Bắt tay ba bước: SYN, SYN-ACK, ACK" },
        { id: "c", text: "Không cần bắt tay, gửi dữ liệu ngay" },
        { id: "d", text: "Bắt tay bốn bước với FIN" },
      ],
      correctOptionId: "b",
      explanation:
        "TCP dùng three-way handshake (SYN → SYN-ACK → ACK) để thiết lập kết nối tin cậy trước khi truyền dữ liệu.",
      citation: citations.videoTcp,
      difficulty: "easy",
      topic: "TCP",
    },
  },
  {
    id: "cp_2",
    documentId: "doc_net_video",
    atSec: 690,
    missed: true,
    question: {
      id: "q_cp_2",
      ordinal: 2,
      stem: "Đặc điểm nào đúng với UDP?",
      options: [
        { id: "a", text: "Đảm bảo thứ tự và độ tin cậy" },
        { id: "b", text: "Không kết nối, độ trễ thấp, không đảm bảo tin cậy" },
        { id: "c", text: "Luôn chậm hơn TCP" },
        { id: "d", text: "Bắt buộc bắt tay ba bước" },
      ],
      correctOptionId: "b",
      explanation:
        "UDP không kết nối, không đảm bảo thứ tự/độ tin cậy nhưng độ trễ thấp — phù hợp streaming, game thời gian thực.",
      citation: citations.videoUdp,
      difficulty: "medium",
      topic: "UDP vs TCP",
    },
  },
];

export function getCheckpoints(docId: string): VideoCheckpoint[] {
  return videoCheckpoints.filter((c) => c.documentId === docId);
}

/* ---------- Flashcards ---------- */

const osCards: Flashcard[] = [
  {
    id: "fc_os_1",
    front: "Context switch là gì và vì sao tạo overhead?",
    back: "Là việc lưu trạng thái tiến trình hiện tại và khôi phục tiến trình kế tiếp. Overhead vì CPU không làm việc hữu ích trong lúc chuyển.",
    citation: citations.osContextSwitch,
    topic: "Định thời CPU",
    difficulty: "medium",
    dueState: "due",
    dueAt: "2026-07-08T00:00:00Z",
  },
  {
    id: "fc_os_2",
    front: "Semaphore hoạt động thế nào?",
    back: "Biến đếm nguyên tử: wait() giảm giá trị (có thể chặn), signal() tăng giá trị để đồng bộ tiến trình.",
    citation: citations.osSync,
    topic: "Đồng bộ tiến trình",
    difficulty: "hard",
    dueState: "overdue",
    dueAt: "2026-07-06T00:00:00Z",
  },
  {
    id: "fc_os_3",
    front: "Round-Robin định thời dựa trên gì?",
    back: "Time quantum cố định cho mỗi tiến trình, luân phiên theo hàng đợi — đảm bảo công bằng.",
    citation: citations.osScheduling,
    topic: "Định thời CPU",
    difficulty: "easy",
    dueState: "mastered",
  },
  {
    id: "fc_os_4",
    front: "Bốn điều kiện Coffman gây deadlock?",
    back: "Mutual exclusion, hold-and-wait, no preemption, circular wait. Phá 1 điều kiện là đủ ngăn deadlock.",
    citation: citations.osSync,
    topic: "Đồng bộ tiến trình",
    difficulty: "medium",
    dueState: "new",
  },
];

export const decks: FlashcardDeck[] = [
  {
    id: "deck_os_ch3",
    documentId: "doc_os_ch3",
    documentTitle: documents[0].title,
    title: "Thẻ ghi nhớ — Quản lý tiến trình",
    total: osCards.length,
    dueCount: 2,
    newCount: 1,
    masteredCount: 1,
    cards: osCards,
  },
];

export function getDeck(id: string): FlashcardDeck | undefined {
  return decks.find((d) => d.id === id);
}

export const dueCardsToday: Flashcard[] = osCards.filter(
  (c) => c.dueState === "due" || c.dueState === "overdue",
);

/* ---------- Courses ---------- */

export const courses: Course[] = [
  {
    id: "course_os",
    name: "Ôn thi cuối kỳ Hệ điều hành",
    subject: "Hệ điều hành",
    goal: "Đạt A cuối kỳ",
    deadline: "2026-07-25",
    language: "Tiếng Việt",
    documentIds: ["doc_os_ch3", "doc_net_video"],
    masteryPct: 58,
    dueReviews: 4,
    lastStudiedAt: "2026-07-07T21:40:00Z",
  },
  {
    id: "course_ml",
    name: "Machine Learning cơ bản",
    subject: "Trí tuệ nhân tạo",
    goal: "Hiểu nền tảng tối ưu",
    language: "Song ngữ",
    documentIds: ["doc_ml_intro"],
    masteryPct: 54,
    dueReviews: 1,
    lastStudiedAt: "2026-07-05T10:00:00Z",
  },
];

export function getCourse(id: string): Course | undefined {
  return courses.find((c) => c.id === id);
}

/* ---------- Weak topics ---------- */

export const weakTopics: WeakTopic[] = [
  {
    id: "wt_sync",
    name: "Đồng bộ tiến trình",
    masteryPct: 45,
    missedQuestions: 3,
    documentTitles: [documents[0].title],
    citations: [citations.osSync],
  },
  {
    id: "wt_gradient",
    name: "Gradient descent",
    masteryPct: 52,
    missedQuestions: 2,
    documentTitles: [documents[1].title],
    citations: [citations.mlGradient],
  },
  {
    id: "wt_udp",
    name: "UDP vs TCP",
    masteryPct: 38,
    missedQuestions: 2,
    documentTitles: [documents[2].title],
    citations: [citations.videoUdp],
  },
];

export function getWeakTopic(id: string): WeakTopic | undefined {
  return weakTopics.find((w) => w.id === id);
}

/* ---------- Study plan ---------- */

export const studyTasks: StudyTask[] = [
  {
    id: "task_1",
    type: "flashcards",
    title: "Ôn 2 thẻ ghi nhớ đến hạn — Quản lý tiến trình",
    documentTitle: documents[0].title,
    estimatedMinutes: 5,
    done: false,
  },
  {
    id: "task_2",
    type: "retry_quiz",
    title: "Làm lại câu sai về Đồng bộ tiến trình",
    documentTitle: documents[0].title,
    estimatedMinutes: 6,
    done: false,
  },
  {
    id: "task_3",
    type: "video_checkpoint",
    title: "Xem lại checkpoint UDP (bạn đã bỏ lỡ)",
    documentTitle: documents[2].title,
    estimatedMinutes: 4,
    done: false,
  },
  {
    id: "task_4",
    type: "ask_tutor",
    title: "Hỏi trợ giảng: so sánh TCP và UDP",
    documentTitle: documents[2].title,
    estimatedMinutes: 3,
    done: true,
  },
];

/* ---------- Exams ---------- */

export const exams: Exam[] = [
  {
    id: "exam_os",
    name: "Thi cuối kỳ Hệ điều hành",
    date: "2026-07-25",
    courseId: "course_os",
    documentIds: ["doc_os_ch3", "doc_net_video"],
    targetScorePct: 85,
    readinessPct: 61,
  },
];

export function getExam(id: string): Exam | undefined {
  return exams.find((e) => e.id === id);
}

/* ---------- Usage / billing ---------- */

export const usage: UsageState = {
  planTier: "free",
  planLabel: "Miễn phí",
  creditsRemaining: 18,
  creditsTotal: 100,
  uploadsUsed: 6,
  uploadsLimit: 10,
  resetDate: "2026-08-01",
};

export const invoices: Invoice[] = [
  {
    id: "inv_202606",
    date: "2026-06-01",
    amount: "0₫",
    status: "paid",
    planLabel: "Miễn phí",
  },
];

/* ---------- Notifications ---------- */

export const notifications: AppNotification[] = [
  {
    id: "n_1",
    type: "document_ready",
    title: "Tài liệu đã sẵn sàng",
    body: "Bài kiểm tra cho “Nhập môn Hệ điều hành — Chương 3” đã được tạo.",
    createdAt: "2026-07-07T21:00:00Z",
    read: false,
    href: "/library/doc_os_ch3",
  },
  {
    id: "n_2",
    type: "review_due",
    title: "2 thẻ ghi nhớ đến hạn ôn",
    body: "Bạn có 2 thẻ cần ôn hôm nay để giữ tiến độ ghi nhớ.",
    createdAt: "2026-07-08T06:00:00Z",
    read: false,
    href: "/review",
  },
  {
    id: "n_3",
    type: "processing_failed",
    title: "Xử lý thất bại",
    body: "“Ghi chú Giải tích — Tích phân từng phần” không xử lý được. Tín dụng đã được hoàn.",
    createdAt: "2026-07-07T16:25:00Z",
    read: true,
    href: "/library/doc_calc_notes",
  },
  {
    id: "n_4",
    type: "credit_low",
    title: "Tín dụng AI sắp hết",
    body: "Bạn còn 18/100 tín dụng. Nâng cấp để tiếp tục xử lý tài liệu lớn.",
    createdAt: "2026-07-08T09:00:00Z",
    read: false,
    href: "/billing/upgrade",
  },
];

/* ---------- Teacher ---------- */

export const classrooms: Classroom[] = [
  {
    id: "class_os_2026",
    name: "Hệ điều hành — Lớp K68 CNTT",
    subject: "Hệ điều hành",
    studentCount: 3,
    documentIds: ["doc_os_ch3", "doc_net_video"],
    avgMasteryPct: 57,
    students: [
      {
        id: "st_1",
        name: "Nguyễn Văn An",
        avgScorePct: 78,
        reviewStreak: 5,
        missingAssignments: 0,
        weakTopics: ["Đồng bộ tiến trình"],
      },
      {
        id: "st_2",
        name: "Trần Thị Bình",
        avgScorePct: 64,
        reviewStreak: 2,
        missingAssignments: 1,
        weakTopics: ["Định thời CPU", "Deadlock"],
      },
      {
        id: "st_3",
        name: "Lê Hoàng Cường",
        avgScorePct: 49,
        reviewStreak: 0,
        missingAssignments: 2,
        weakTopics: ["Đồng bộ tiến trình", "UDP vs TCP"],
      },
    ],
  },
];

export function getClassroom(id: string): Classroom | undefined {
  return classrooms.find((c) => c.id === id);
}

export function getStudent(id: string) {
  for (const cls of classrooms) {
    const s = cls.students.find((st) => st.id === id);
    if (s) return { student: s, classroom: cls };
  }
  return undefined;
}

export const assignments: Assignment[] = [
  {
    id: "asg_1",
    classId: "class_os_2026",
    title: "Quiz Chương 3 — Quản lý tiến trình",
    documentTitle: documents[0].title,
    dueDate: "2026-07-15",
    submittedCount: 2,
    totalCount: 3,
    status: "published",
  },
  {
    id: "asg_2",
    classId: "class_os_2026",
    title: "Checkpoint video — Giao thức TCP",
    documentTitle: documents[2].title,
    dueDate: "2026-07-18",
    submittedCount: 0,
    totalCount: 3,
    status: "draft",
  },
];

/* ---------- Admin ---------- */

export const jobs: Job[] = [
  {
    id: "job_1",
    documentTitle: documents[3].title,
    owner: "owner_8821",
    status: "running",
    step: "chunk",
    correlationId: "corr_a1b2c3",
    costEstimate: "0.042$",
  },
  {
    id: "job_2",
    documentTitle: documents[4].title,
    owner: "owner_1044",
    status: "failed",
    step: "extract",
    correlationId: "corr_d4e5f6",
    costEstimate: "0.011$",
    errorReason: "Nội dung trích xuất quá ngắn để sinh câu hỏi.",
  },
  {
    id: "job_3",
    documentTitle: documents[0].title,
    owner: "owner_8821",
    status: "completed",
    step: "ready",
    correlationId: "corr_g7h8i9",
    costEstimate: "0.087$",
  },
];

/* ---------- Shared helpers ---------- */

export function formatSec(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  return formatVietnameseDate(iso);
}

export function formatDateTime(iso: string): string {
  return formatVietnameseShortDateTime(iso);
}

/** Simulate an async backend call for realistic loading states. */
export function mockDelay<T>(value: T, ms = 700): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
