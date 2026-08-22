/**
 * Domain types for LearningPlatform FE (mock layer).
 * Vocabulary mirrors CONTEXT.md: Document owns generated content; Course only references.
 */

export type DocumentType = "pdf" | "text" | "video" | "audio";
export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";
export type OutputKind = "quiz" | "flashcards" | "tutor" | "checkpoints";

export type ProcessingStepKey =
  | "verified"
  | "extract"
  | "transcribe"
  | "chunk"
  | "generate"
  | "validate"
  | "build"
  | "ready";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface ProcessingStep {
  key: ProcessingStepKey;
  label: string;
  status: StepStatus;
}

/** Tagged-union locator — foundation of every citation. */
export type Locator =
  | { kind: "page"; page: number }
  | { kind: "text-range"; start: number; end: number }
  | { kind: "time"; startSec: number; endSec: number };

/** Self-contained citation: chunkId to trace, locator + snippet embedded to display. */
export interface Citation {
  chunkId: string;
  locator: Locator;
  snippet: string;
  documentId: string;
  documentTitle: string;
}

export interface LearningDocument {
  id: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  uploadedAt: string;
  lastStudiedAt?: string;
  courseId?: string;
  tags: string[];
  pages?: number;
  durationSec?: number;
  outputs: OutputKind[];
  masteryPct?: number;
  lastAttemptScorePct?: number;
  processing?: {
    percent: number;
    steps: ProcessingStep[];
    etaSec?: number;
    failureReason?: string;
    creditsRefunded?: boolean;
  };
  weakTopics?: string[];
}

export type QuizMode = "practice" | "test";
export type Difficulty = "easy" | "medium" | "hard";

export interface QuizOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  ordinal: number;
  stem: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  citation: Citation;
  difficulty: Difficulty;
  topic: string;
}

export interface Quiz {
  id: string;
  documentId: string;
  documentTitle: string;
  title: string;
  questionCount: number;
  estimatedMinutes: number;
  difficultyMix: Record<Difficulty, number>;
  coverageTopics: string[];
  questions: Question[];
}

export interface AttemptAnswer {
  questionId: string;
  selectedOptionId: string | null;
  correct: boolean;
  flagged?: boolean;
}

export interface Attempt {
  id: string;
  quizId: string;
  documentTitle: string;
  mode: QuizMode;
  submittedAt: string;
  scorePct: number;
  correctCount: number;
  totalCount: number;
  timeSpentSec: number;
  answers: AttemptAnswer[];
  topicBreakdown: { topic: string; correct: number; total: number }[];
}

export interface VideoCheckpoint {
  id: string;
  documentId: string;
  atSec: number;
  question: Question;
  completed?: boolean;
  missed?: boolean;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  citation: Citation;
  topic: string;
  difficulty: Difficulty;
  dueState: "new" | "due" | "upcoming" | "overdue" | "mastered";
  dueAt?: string;
}

export interface FlashcardDeck {
  id: string;
  documentId: string;
  documentTitle: string;
  title: string;
  total: number;
  dueCount: number;
  newCount: number;
  masteredCount: number;
  cards: Flashcard[];
}

export interface Course {
  id: string;
  name: string;
  subject: string;
  goal?: string;
  deadline?: string;
  language: string;
  documentIds: string[];
  masteryPct: number;
  dueReviews: number;
  lastStudiedAt?: string;
}

export interface TutorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  noEvidence?: boolean;
}

export interface TutorContext {
  scope: "all" | "course" | "document";
  label: string;
  documentIds: string[];
}

export type NotificationType =
  | "document_ready"
  | "processing_failed"
  | "review_due"
  | "weak_topic"
  | "quiz_result"
  | "credit_low"
  | "billing"
  | "assignment_due";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  href?: string;
}

export interface WeakTopic {
  id: string;
  name: string;
  masteryPct: number;
  missedQuestions: number;
  documentTitles: string[];
  citations: Citation[];
}

export interface StudyTask {
  id: string;
  type:
    | "flashcards"
    | "retry_quiz"
    | "video_checkpoint"
    | "read_source"
    | "ask_tutor"
    | "practice_exam";
  title: string;
  documentTitle?: string;
  estimatedMinutes: number;
  done: boolean;
}

export interface Exam {
  id: string;
  name: string;
  date: string;
  courseId?: string;
  documentIds: string[];
  targetScorePct: number;
  readinessPct: number;
}

export type PlanTier = "free" | "student_plus" | "pro_learner" | "teacher" | "enterprise";

export interface UsageState {
  planTier: PlanTier;
  planLabel: string;
  creditsRemaining: number;
  creditsTotal: number;
  uploadsUsed: number;
  uploadsLimit: number;
  resetDate: string;
}

export interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: "paid" | "pending" | "failed";
  planLabel: string;
}

/* Teacher */
export interface ClassStudent {
  id: string;
  name: string;
  avgScorePct: number;
  reviewStreak: number;
  missingAssignments: number;
  weakTopics: string[];
}

export interface Classroom {
  id: string;
  name: string;
  subject: string;
  studentCount: number;
  documentIds: string[];
  avgMasteryPct: number;
  students: ClassStudent[];
}

export interface Assignment {
  id: string;
  classId: string;
  title: string;
  documentTitle: string;
  dueDate: string;
  submittedCount: number;
  totalCount: number;
  status: "draft" | "published" | "closed";
}

/* Admin */
export interface Job {
  id: string;
  documentTitle: string;
  owner: string;
  status: "pending" | "running" | "completed" | "failed";
  step: ProcessingStepKey;
  correlationId: string;
  costEstimate: string;
  errorReason?: string;
}

export interface AdminMetric {
  label: string;
  value: string;
  delta?: string;
  tone?: "up" | "down" | "neutral";
}
