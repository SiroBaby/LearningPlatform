/** Central route map — single source of truth for navigation links. */

export const routes = {
  // Public
  landing: "/",
  product: "/product",
  pricing: "/pricing",
  examples: "/examples",
  faq: "/faq",
  privacy: "/privacy",
  terms: "/terms",

  // Auth
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  onboarding: "/onboarding",

  // Learner app
  home: "/home",
  upload: "/upload",
  processing: (docId: string) => `/processing/${docId}`,
  library: "/library",
  document: (id: string) => `/library/${id}`,
  quizStart: (quizId: string) => `/quiz/${quizId}`,
  quizPlay: (quizId: string) => `/quiz/${quizId}/play`,
  quizResult: (quizId: string, attemptId: string) =>
    `/quiz/${quizId}/result/${attemptId}`,
  videoPlayer: (docId: string) => `/library/${docId}/video`,
  deck: (deckId: string) => `/flashcards/${deckId}`,
  deckReview: (deckId: string) => `/flashcards/${deckId}/review`,
  review: "/review",
  tutor: "/tutor",
  courses: "/courses",
  course: (id: string) => `/courses/${id}`,
  analytics: "/analytics",
  weakTopic: (id: string) => `/analytics/weak-topic/${id}`,
  studyPlan: "/study-plan",
  examSetup: "/exam/setup",
  practiceExam: (examId: string) => `/exam/${examId}/practice`,
  examResult: (examId: string, attemptId: string) =>
    `/exam/${examId}/result/${attemptId}`,
  notifications: "/notifications",
  billing: "/billing",
  upgrade: "/billing/upgrade",
  settings: "/settings",

  // Teacher
  teacherHome: "/teacher",
  teacherClasses: "/teacher/classes",
  teacherClass: (id: string) => `/teacher/classes/${id}`,
  teacherAssignmentNew: "/teacher/assignments/new",
  teacherStudent: (id: string) => `/teacher/students/${id}`,

  // Admin
  adminOverview: "/admin",
  adminJobs: "/admin/jobs",
  adminCost: "/admin/cost",
  adminSupport: "/admin/support",
  adminModeration: "/admin/moderation",
} as const;
