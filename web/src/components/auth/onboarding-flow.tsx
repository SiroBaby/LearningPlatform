"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpenCheck, Loader2, Upload } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  LinkButton,
  ProgressBar,
  StepTimeline,
} from "@/components/ui";
import { buildSteps } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import {
  AuthHelperPanel,
  AuthOptionCard,
  AuthStatusMessage,
} from "./auth-primitives";

const onboardingSteps = [
  {
    key: "goal",
    title: "Bạn muốn học để làm gì?",
    description:
      "Chọn mục tiêu chính để nội dung và nhịp học phù hợp hơn với bạn.",
  },
  {
    key: "language",
    title: "Bạn muốn được giải thích bằng ngôn ngữ nào?",
    description:
      "Lựa chọn này áp dụng cho giao diện và lời giải. Bạn có thể đổi lại trong Cài đặt.",
  },
  {
    key: "level",
    title: "Mức độ giải thích nào phù hợp với bạn?",
    description:
      "Chọn bối cảnh học gần nhất để lời giải vừa đủ sâu. Lựa chọn này không đánh giá năng lực của bạn.",
  },
  {
    key: "firstAction",
    title: "Bạn muốn bắt đầu từ đâu?",
    description:
      "Bạn có thể dùng tài liệu của mình hoặc xem một ví dụ có sẵn trước.",
  },
  {
    key: "acceptsTrustNote",
    title: "Một lưu ý trước khi bắt đầu",
    description:
      "AI có thể trả lời chưa chính xác. Khi cần, bạn luôn có thể mở nguồn để kiểm tra lại.",
  },
] as const;

type LearningGoal = "exam-prep" | "course-study" | "self-learning" | "teaching";
type PreferredLanguage = "vietnamese" | "english";
type LearnerLevel = "high-school" | "university" | "professional" | "other";
type FirstAction = "upload" | "sample";

type OnboardingField =
  | "goal"
  | "language"
  | "level"
  | "firstAction"
  | "acceptsTrustNote";

interface OnboardingValues {
  goal: LearningGoal | "";
  language: PreferredLanguage | "";
  level: LearnerLevel | "";
  firstAction: FirstAction | "";
  acceptsTrustNote: boolean;
}

interface StepContent {
  eyebrow: string;
  title: string;
  description: string;
  highlight: string;
  items: readonly string[];
}

const goalOptions: readonly {
  value: LearningGoal;
  title: string;
  description: string;
  detail: string;
}[] = [
  {
    value: "exam-prep",
    title: "Ôn thi",
    description: "Ôn lại kiến thức trọng tâm và luyện những phần bạn còn chưa chắc.",
    detail: "Phù hợp khi bạn muốn biết hôm nay nên tập trung vào phần nào.",
  },
  {
    value: "course-study",
    title: "Học theo môn học",
    description: "Theo dõi tài liệu và tiến độ theo từng môn.",
    detail: "Phù hợp khi bạn học nhiều môn và muốn giữ mọi thứ ngăn nắp.",
  },
  {
    value: "self-learning",
    title: "Tự học theo nhịp riêng",
    description: "Đọc, đặt câu hỏi và ôn lại theo cách phù hợp với bạn.",
    detail: "Hữu ích khi bạn muốn tự chọn nội dung và thời gian học.",
  },
  {
    value: "teaching",
    title: "Chuẩn bị bài giảng",
    description: "Tạo câu hỏi và nội dung để chia sẻ với lớp hoặc nhóm học.",
    detail: "Dành cho giáo viên, gia sư hoặc người tổ chức nhóm ôn tập.",
  },
];

const languageOptions: readonly {
  value: PreferredLanguage;
  title: string;
  description: string;
  detail: string;
}[] = [
  {
    value: "vietnamese",
    title: "Tiếng Việt",
    description: "Giao diện và lời giải ưu tiên tiếng Việt tự nhiên.",
    detail: "Phù hợp với tài liệu, ghi chú hoặc bài học bằng tiếng Việt.",
  },
  {
    value: "english",
    title: "Tiếng Anh",
    description: "Giao diện và lời giải ưu tiên tiếng Anh.",
    detail: "Phù hợp với tài liệu hoặc khóa học bằng tiếng Anh.",
  },
];

const levelOptions: readonly {
  value: LearnerLevel;
  title: string;
  description: string;
  detail: string;
}[] = [
  {
    value: "high-school",
    title: "Trung học",
    description: "Lời giải gọn, rõ và bám sát kiến thức nền.",
    detail: "Phù hợp với bài học và đề kiểm tra ở bậc trung học.",
  },
  {
    value: "university",
    title: "Đại học",
    description: "Cân bằng giữa khái niệm, nguyên lý và bài tập.",
    detail: "Phù hợp với giáo trình, slide môn học và bài giảng chuyên sâu.",
  },
  {
    value: "professional",
    title: "Đi làm hoặc chuyên môn",
    description: "Lời giải cô đọng, gắn với tình huống thực tế.",
    detail: "Phù hợp với tài liệu nghề nghiệp, chứng chỉ hoặc đào tạo nội bộ.",
  },
  {
    value: "other",
    title: "Khác",
    description: "Chọn mức gần nhất, bạn có thể thay đổi sau.",
    detail: "Hữu ích nếu bạn chưa chắc mức độ nào phù hợp nhất.",
  },
];

const firstActionOptions: readonly {
  value: FirstAction;
  title: string;
  description: string;
  detail: string;
}[] = [
  {
    value: "upload",
    title: "Dùng tài liệu của tôi",
    description: "Bắt đầu với PDF, ghi chú hoặc tệp học tập bạn đang có.",
    detail: "Phù hợp khi bạn đã có tài liệu và muốn học ngay từ nội dung đó.",
  },
  {
    value: "sample",
    title: "Xem ví dụ trước",
    description: "Xem một vòng học mẫu mà chưa cần chuẩn bị tài liệu.",
    detail: "Phù hợp nếu bạn muốn làm quen trước khi dùng tài liệu riêng.",
  },
];

const stepContentMap: Record<number, StepContent> = {
  0: {
    eyebrow: "Mục tiêu của bạn",
    title: "Bắt đầu từ điều bạn muốn đạt được",
    description:
      "Mục tiêu giúp bạn tập trung vào nội dung và nhịp học phù hợp hơn.",
    highlight: "Bạn có thể đổi mục tiêu khi nhu cầu học thay đổi.",
    items: [
      "Gợi ý học sẽ bám theo mục tiêu này.",
      "Bạn có thể đổi mục tiêu bất cứ lúc nào trong Cài đặt.",
      "Lựa chọn này không dùng để chấm điểm bạn.",
    ],
  },
  1: {
    eyebrow: "Ngôn ngữ",
    title: "Đọc và nhận lời giải theo cách tự nhiên",
    description:
      "Nếu tài liệu có thuật ngữ tiếng Anh, bạn vẫn có thể chọn lời giải tiếng Việt để dễ theo dõi.",
    highlight: "Bạn có thể giữ nguyên từ chuyên môn quen thuộc khi điều đó giúp dễ hiểu hơn.",
    items: [
      "Giao diện và lời giải ưu tiên ngôn ngữ bạn chọn.",
      "Bạn vẫn có thể học từ tài liệu bằng ngôn ngữ khác.",
      "Bạn có thể đổi lựa chọn này sau trong Cài đặt.",
    ],
  },
  2: {
    eyebrow: "Mức độ phù hợp",
    title: "Chọn mức độ phù hợp với việc học hôm nay",
    description:
      "Mức độ này giúp lời giải vừa đủ sâu cho bối cảnh học của bạn.",
    highlight: "Lựa chọn này chỉ điều chỉnh cách giải thích, không gắn nhãn năng lực.",
    items: [
      "Lời giải sẽ gần với nền tảng hiện tại của bạn hơn.",
      "Ví dụ minh họa sẽ phù hợp với bối cảnh học bạn chọn.",
      "Bạn có thể thay đổi lựa chọn này sau khi bắt đầu.",
    ],
  },
  3: {
    eyebrow: "Cách bắt đầu",
    title: "Bắt đầu bằng cách bạn thấy thuận tiện",
    description:
      "Chưa có tài liệu? Bạn có thể xem ví dụ trước rồi quay lại dùng tài liệu riêng.",
    highlight: "Bạn có thể bỏ qua lúc này và quay lại từ Trang chủ hoặc Cài đặt.",
    items: [
      "Dùng tài liệu riêng khi bạn đã sẵn sàng.",
      "Xem ví dụ để làm quen trước.",
      "Cả hai lựa chọn đều đưa bạn đến bài học đầu tiên.",
    ],
  },
  4: {
    eyebrow: "Kiểm tra nguồn",
    title: "Bạn luôn có thể đối chiếu với tài liệu gốc",
    description:
      "AI có thể hiểu thiếu hoặc trả lời chưa đúng. Khi cần, bạn có thể mở phần tài liệu liên quan để tự kiểm tra.",
    highlight: "Hãy xem câu trả lời AI là điểm bắt đầu, không phải kết luận cuối cùng.",
    items: [
      "Lời giải sẽ đi kèm nguồn khi có thể.",
      "Nếu chưa chắc, hãy mở tài liệu và tự đối chiếu.",
      "Bạn có thể xem lại lưu ý này trong Cài đặt.",
    ],
  },
};

function profileValues(values: OnboardingValues): Record<string, string> {
  return {
    learningGoal: values.goal,
    preferredLanguage: values.language === "vietnamese" ? "vi" : "en",
    proficiencyLevel: values.level === "high-school" ? "BEGINNER" : values.level === "professional" ? "ADVANCED" : "INTERMEDIATE",
  };
}

function hasStepErrors(errors: Partial<Record<OnboardingField, string>>): boolean {
  return Object.values(errors).some(Boolean);
}

function getStepErrorField(
  stepIndex: number,
): OnboardingField {
  return onboardingSteps[stepIndex].key;
}

function getStepValidationErrors(
  stepIndex: number,
  values: OnboardingValues,
): Partial<Record<OnboardingField, string>> {
  const errors: Partial<Record<OnboardingField, string>> = {};

  if (stepIndex === 0 && !values.goal) {
    errors.goal = "Chọn một mục tiêu chính để nhận gợi ý học phù hợp hơn.";
  }

  if (stepIndex === 1 && !values.language) {
    errors.language = "Chọn ngôn ngữ bạn muốn dùng cho giao diện và lời giải.";
  }

  if (stepIndex === 2 && !values.level) {
    errors.level = "Chọn mức độ gần nhất với nhu cầu hiện tại của bạn.";
  }

  if (stepIndex === 3 && !values.firstAction) {
    errors.firstAction = "Chọn cách bạn muốn bắt đầu: dùng tài liệu riêng hoặc xem ví dụ.";
  }

  if (stepIndex === 4 && !values.acceptsTrustNote) {
    errors.acceptsTrustNote =
      "Hãy xác nhận rằng bạn sẽ kiểm tra nguồn tài liệu khi cần.";
  }

  return errors;
}

function getGoalLabel(goal: LearningGoal | ""): string {
  return goalOptions.find((option) => option.value === goal)?.title ?? "Chưa chọn";
}

function getLanguageLabel(language: PreferredLanguage | ""): string {
  return languageOptions.find((option) => option.value === language)?.title ?? "Chưa chọn";
}

function getLevelLabel(level: LearnerLevel | ""): string {
  return levelOptions.find((option) => option.value === level)?.title ?? "Chưa chọn";
}

function getFirstActionLabel(firstAction: FirstAction | ""): string {
  return firstActionOptions.find((option) => option.value === firstAction)?.title ?? "Chưa chọn";
}

function getCompletionSummary(values: OnboardingValues): readonly string[] {
  return [
    `Mục tiêu: ${getGoalLabel(values.goal)}`,
    `Ngôn ngữ: ${getLanguageLabel(values.language)}`,
    `Mức độ: ${getLevelLabel(values.level)}`,
    `Bắt đầu bằng: ${getFirstActionLabel(values.firstAction)}`,
  ] as const;
}

function getStepProgress(currentStep: number): number {
  return Math.round(((currentStep + 1) / onboardingSteps.length) * 100);
}

export function OnboardingFlow(): ReactNode {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<OnboardingValues>({
    goal: "",
    language: "",
    level: "",
    firstAction: "",
    acceptsTrustNote: false,
  });
  const [errors, setErrors] = useState<Partial<Record<OnboardingField, string>>>({});
  const [isPending, setIsPending] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const stepContent = stepContentMap[currentStep];
  const progressValue = getStepProgress(currentStep);
  const summaryItems = useMemo(() => getCompletionSummary(values), [values]);

  function clearStepError(field: OnboardingField): void {
    if (!errors[field]) {
      return;
    }

    const nextErrors = { ...errors };
    delete nextErrors[field];
    setErrors(nextErrors);
  }

  function updateValue<Key extends keyof OnboardingValues>(
    field: Key,
    value: OnboardingValues[Key],
  ): void {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
    clearStepError(field as OnboardingField);

    if (hasCompleted) {
      setHasCompleted(false);
    }
  }

  function goBack(): void {
    if (currentStep === 0) {
      return;
    }

    setCurrentStep((step) => step - 1);
  }

  function goNext(): void {
    const nextErrors = getStepValidationErrors(currentStep, values);
    setErrors(nextErrors);

    if (hasStepErrors(nextErrors)) {
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, onboardingSteps.length - 1));
  }

  async function handleFinish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = getStepValidationErrors(currentStep, values);
    setErrors(nextErrors);

    if (hasStepErrors(nextErrors)) {
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/auth/profile", {
        body: JSON.stringify({ ...profileValues(values), onboardingAction: "complete" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error("profile update failed");
      setHasCompleted(true);
      setSubmitError(false);
    } catch {
      setSubmitError(true);
    } finally {
      setIsPending(false);
    }
  }

  async function skipOnboarding(): Promise<void> {
    if (isPending) return;
    setIsPending(true);
    setSubmitError(false);
    try {
      const response = await fetch("/auth/profile", {
        body: JSON.stringify({ onboardingAction: "skip" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error("profile update failed");
      router.replace(routes.home);
      router.refresh();
    } catch {
      setSubmitError(true);
      setIsPending(false);
    }
  }

  const stepErrorField = getStepErrorField(currentStep);
  const stepErrorMessage = errors[stepErrorField];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-ink-700">
            Bước {currentStep + 1}/{onboardingSteps.length}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Chọn vài điều để bắt đầu. Bạn có thể bỏ qua và quay lại trong Cài đặt.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={routes.settings} variant="ghost" size="sm">
            Xem trong Cài đặt
          </LinkButton>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => void skipOnboarding()}>
            Bỏ qua
          </Button>
        </div>
      </div>

      {hasCompleted ? (
        <AuthStatusMessage
          title="Bạn đã sẵn sàng"
          description="Các lựa chọn của bạn đã được lưu. Hãy bắt đầu bằng cách phù hợp nhất với bạn."
          tone="success"
        >
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {summaryItems.map((item) => (
                <div key={item} className="rounded-xl border border-success-100 bg-white px-3 py-2 text-sm text-ink-700">
                  {item}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <LinkButton
                href={values.firstAction === "sample" ? routes.home : routes.upload}
                className="w-full sm:w-auto"
              >
                {values.firstAction === "sample" ? "Xem ví dụ" : "Tải tài liệu lên"}
                <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={routes.settings} variant="outline" className="w-full sm:w-auto">
                Thay đổi lựa chọn
              </LinkButton>
            </div>
          </div>
        </AuthStatusMessage>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-ink-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
              {stepContent.eyebrow}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-ink-900">
              {onboardingSteps[currentStep].title}
            </h2>
          </div>
          <Badge tone="brand">{progressValue}%</Badge>
        </div>
        <ProgressBar value={progressValue} />
        <p className="text-sm leading-6 text-ink-600">
          {onboardingSteps[currentStep].description}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <form className="space-y-4" onSubmit={handleFinish} noValidate>
          {currentStep === 0 ? (
            <div className="space-y-3" role="radiogroup" aria-labelledby="goal-group-label">
              <label id="goal-group-label" className="block text-sm font-medium text-ink-700">
                Mục tiêu học chính
              </label>
              {goalOptions.map((option) => (
                <AuthOptionCard
                  key={option.value}
                  id={`goal-${option.value}`}
                  title={option.title}
                  description={option.description}
                  detail={option.detail}
                  isSelected={values.goal === option.value}
                  onSelect={() => updateValue("goal", option.value)}
                />
              ))}
            </div>
          ) : null}

          {currentStep === 1 ? (
            <div className="space-y-3" role="radiogroup" aria-labelledby="language-group-label">
              <label id="language-group-label" className="block text-sm font-medium text-ink-700">
                Ngôn ngữ ưu tiên
              </label>
              {languageOptions.map((option) => (
                <AuthOptionCard
                  key={option.value}
                  id={`language-${option.value}`}
                  title={option.title}
                  description={option.description}
                  detail={option.detail}
                  isSelected={values.language === option.value}
                  onSelect={() => updateValue("language", option.value)}
                />
              ))}
            </div>
          ) : null}

          {currentStep === 2 ? (
            <div className="space-y-3" role="radiogroup" aria-labelledby="level-group-label">
              <label id="level-group-label" className="block text-sm font-medium text-ink-700">
                Trình độ hoặc bối cảnh học gần nhất
              </label>
              {levelOptions.map((option) => (
                <AuthOptionCard
                  key={option.value}
                  id={`level-${option.value}`}
                  title={option.title}
                  description={option.description}
                  detail={option.detail}
                  isSelected={values.level === option.value}
                  onSelect={() => updateValue("level", option.value)}
                />
              ))}
            </div>
          ) : null}

          {currentStep === 3 ? (
            <div className="space-y-4">
              <div className="space-y-3" role="radiogroup" aria-labelledby="first-action-group-label">
                <label id="first-action-group-label" className="block text-sm font-medium text-ink-700">
                  Cách bắt đầu bạn muốn thử
                </label>
                {firstActionOptions.map((option) => (
                  <AuthOptionCard
                    key={option.value}
                    id={`first-action-${option.value}`}
                    title={option.title}
                    description={option.description}
                    detail={option.detail}
                    isSelected={values.firstAction === option.value}
                    onSelect={() => updateValue("firstAction", option.value)}
                  />
                ))}
              </div>
              <Card className="border-brand-100 bg-brand-50/60">
                <CardBody className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-brand-700">
                    <BookOpenCheck className="h-4 w-4" aria-hidden />
                    Xem trước
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      Nhập môn Hệ điều hành: Quản lý tiến trình
                    </CardTitle>
                    <p className="text-sm leading-6 text-ink-600">
                      Bạn sẽ thấy cách một tài liệu trở thành câu hỏi, lời giải và phần ôn lại.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm text-ink-700">
                      5 câu hỏi có lời giải và nguồn tham khảo
                    </div>
                    <div className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm text-ink-700">
                      Nhắc lại phần bạn còn chưa chắc để ôn tiếp
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          ) : null}

          {currentStep === 4 ? (
            <div className="space-y-4">
              <Card className="border-ink-200 bg-ink-50/70">
                <CardBody className="space-y-4">
                  <div className="space-y-2">
                    <Badge tone="brand">Học có kiểm chứng</Badge>
                    <CardTitle className="text-base">
                      Một vòng học đáng tin cậy
                    </CardTitle>
                    <p className="text-sm leading-6 text-ink-600">
                      Bạn trả lời câu hỏi, xem lời giải rồi mở tài liệu gốc để kiểm tra khi cần.
                    </p>
                  </div>
                  <StepTimeline
                    steps={buildSteps(6).map((step, index) => ({
                      ...step,
                      label: [
                        "Mở tài liệu",
                        "Đọc nội dung",
                        "Tìm ý chính",
                        "Tạo câu hỏi",
                        "Kiểm tra câu trả lời",
                        "Chuẩn bị phần ôn tập",
                        "Bắt đầu học",
                      ][index] ?? step.label,
                    }))}
                  />
                </CardBody>
              </Card>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={values.acceptsTrustNote}
                    onChange={(event) => updateValue("acceptsTrustNote", event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>
                    Tôi hiểu AI có thể trả lời chưa chính xác. Khi cần, tôi sẽ mở nguồn tài liệu để kiểm tra lại.
                  </span>
                </label>
              </div>
            </div>
          ) : null}

          {stepErrorMessage ? (
            <p className="text-sm text-error-600" role="alert">
              {stepErrorMessage}
            </p>
          ) : null}
          {submitError ? (
            <p className="text-sm text-error-600" role="alert">
              Không thể lưu thiết lập. Vui lòng thử lại.
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-ink-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={goBack} disabled={currentStep === 0 || isPending}>
                <ArrowLeft className="h-4 w-4" />
                Quay lại
              </Button>
              <Button type="button" variant="ghost" disabled={isPending} onClick={() => void skipOnboarding()}>
                Bỏ qua thiết lập
              </Button>
            </div>
            <div className="flex gap-2">
              {currentStep < onboardingSteps.length - 1 ? (
                <Button type="button" onClick={goNext}>
                  Tiếp tục
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Đang lưu thiết lập…
                    </>
                  ) : (
                    <>
                      Hoàn tất thiết lập
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </form>

        <div className="space-y-4">
          <AuthHelperPanel
            badge={stepContent.eyebrow}
            title={stepContent.title}
            description={stepContent.description}
            items={stepContent.items}
          />
          <Card className="border-brand-100 bg-brand-50/60">
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand-700">
                <Upload className="h-4 w-4" aria-hidden />
                Điều đáng chú ý ở bước này
              </div>
              <p className="text-sm leading-6 text-ink-700">{stepContent.highlight}</p>
              <div className="grid gap-2">
                {summaryItems.map((item) => (
                  <div key={item} className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm text-ink-600">
                    {item}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
