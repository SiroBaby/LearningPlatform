"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
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
  MockModeNote,
} from "./auth-primitives";

const SIMULATED_SUBMIT_MS = 700;

const onboardingSteps = [
  {
    key: "goal",
    title: "Bạn muốn LearningPlatform ưu tiên điều gì?",
    description:
      "Chọn mục tiêu chính để hệ thống ưu tiên đúng kiểu quiz, review queue và gợi ý học tiếp theo.",
  },
  {
    key: "language",
    title: "Ngôn ngữ giải thích nào hợp với bạn?",
    description:
      "Thiết lập này ảnh hưởng tới cách hiện quiz, tutor và helper copy. Bạn đổi lại bất kỳ lúc nào trong Settings.",
  },
  {
    key: "level",
    title: "Mức độ nội dung nên ở đâu?",
    description:
      "Chúng tôi dùng mức độ này để chọn tông giải thích và độ sâu của câu hỏi, không phải để chấm điểm bạn.",
  },
  {
    key: "firstAction",
    title: "Bạn muốn tới first value bằng cách nào?",
    description:
      "Nếu chưa sẵn tài liệu riêng, bạn vẫn có thể thử sample document để xem rõ cách citation và feedback hoạt động.",
  },
  {
    key: "acceptsTrustNote",
    title: "Một lưu ý ngắn về citation và giới hạn của AI",
    description:
      "Trước khi bắt đầu, hãy xác nhận bạn muốn học theo cách source-grounded thay vì tin mù quáng vào đầu ra AI.",
  },
] as const;

type LearningGoal = "exam-prep" | "course-study" | "self-learning" | "teaching";
type PreferredLanguage = "vietnamese" | "english" | "mixed";
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
    description: "Ưu tiên câu hỏi active recall, retry mistakes và review queue sát deadline.",
    detail: "Phù hợp khi bạn muốn biết hôm nay nên học gì để vào phòng thi tự tin hơn.",
  },
  {
    value: "course-study",
    title: "Học theo môn / course",
    description: "Tổ chức tài liệu theo môn, chapter và tiến độ học dài hơi.",
    detail: "Hợp với người học có nhiều document và muốn theo dõi mastery theo course.",
  },
  {
    value: "self-learning",
    title: "Tự học",
    description: "Giữ tông giải thích thân thiện, nhiều prompt kiểu explain / quiz me / summarize.",
    detail: "Hữu ích khi bạn vừa đọc tài liệu, vừa cần tutor giải thích lại bằng ngôn ngữ dễ hiểu.",
  },
  {
    value: "teaching",
    title: "Dạy học / tutoring",
    description: "Nhấn mạnh khả năng tạo câu hỏi, checkpoint và nội dung chia sẻ cho nhóm học.",
    detail: "Dành cho tutor, giáo viên hoặc người làm nhóm ôn tập.",
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
    description: "Quiz, helper copy và giải thích ưu tiên tiếng Việt tự nhiên.",
    detail: "Phù hợp với slide, ghi chú hoặc ôn thi theo cách diễn đạt quen thuộc.",
  },
  {
    value: "english",
    title: "English",
    description: "Giữ thuật ngữ và lời giải nghiêng nhiều hơn về tiếng Anh học thuật.",
    detail: "Hợp với paper, tài liệu kỹ thuật hoặc khóa học quốc tế.",
  },
  {
    value: "mixed",
    title: "Mixed Việt / Anh",
    description: "Giữ technical terms bằng English nhưng giải thích chính bằng tiếng Việt rõ ràng.",
    detail: "Lựa chọn cân bằng cho người học ở Việt Nam dùng nhiều tài liệu song ngữ.",
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
    title: "High school",
    description: "Ngôn ngữ gọn, dễ bám sát đề và kiểm tra kiến thức nền.",
    detail: "Ưu tiên câu hỏi rõ ý, ít giả định nền tảng học thuật quá sâu.",
  },
  {
    value: "university",
    title: "University",
    description: "Cân bằng giữa ôn khái niệm, giải thích nguyên lý và liên hệ bài tập.",
    detail: "Phù hợp với slide môn học, giáo trình và bài giảng dài hơn.",
  },
  {
    value: "professional",
    title: "Professional",
    description: "Giải thích cô đọng hơn, chấp nhận nhiều technical terms và tình huống thực tế.",
    detail: "Hợp với chứng chỉ, upskill hoặc tài liệu nội bộ dài, dày đặc kiến thức.",
  },
  {
    value: "other",
    title: "Khác / để tôi tự chỉnh sau",
    description: "Chọn tạm để đi nhanh đến first value, bạn có thể tinh chỉnh lại trong Settings.",
    detail: "Hữu ích nếu bạn chưa chắc mức độ nào hợp nhất với tài liệu của mình.",
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
    title: "Tải tài liệu của tôi ngay",
    description: "Đi thẳng tới upload để thử PDF, text, video hoặc audio của riêng bạn.",
    detail: "Tốt nhất khi bạn đã sẵn file và muốn thấy quiz, flashcard hoặc checkpoint ngay từ tài liệu thật.",
  },
  {
    value: "sample",
    title: "Xem sample document trước",
    description: "Khám phá quiz có citation, review queue và feedback mà chưa cần chuẩn bị file.",
    detail: "Rất hợp nếu bạn chỉ muốn hiểu UX trước khi tin tưởng upload tài liệu riêng.",
  },
];

const stepContentMap: Record<number, StepContent> = {
  0: {
    eyebrow: "Mục tiêu học",
    title: "Để hệ thống ưu tiên đúng việc bạn cần nhất",
    description:
      "LearningPlatform không nên cư xử như chatbot chung chung. Mục tiêu học giúp ưu tiên đúng next best action ngay từ màn hình đầu tiên.",
    highlight: "Ví dụ: người ôn thi cần retry mistakes sớm hơn, còn người tự học có thể cần tutor giải thích lại nhiều hơn.",
    items: [
      "Review queue sẽ khác nhau giữa ôn thi và học dài hạn.",
      "Các helper CTA nên nói đúng giọng điệu: thử ngay, ôn lại, hay khám phá tài liệu.",
      "Bạn vẫn đổi lại được sau trong Settings nếu nhu cầu thay đổi.",
    ],
  },
  1: {
    eyebrow: "Ngôn ngữ ưu tiên",
    title: "Giải thích tự nhiên với tài liệu Việt / Anh / mixed",
    description:
      "Nhiều người học ở Việt Nam cần giao diện và tutor vừa giữ technical terms, vừa giải thích bằng tiếng Việt dễ hiểu. Đây là setting mặc định cho trải nghiệm đó.",
    highlight: "Không ép dịch cứng toàn bộ thuật ngữ khi điều đó làm giảm độ rõ ràng của nội dung học.",
    items: [
      "Long Vietnamese text cần wrap đẹp, không làm layout vỡ trên mobile.",
      "Mixed mode phù hợp nhất khi tài liệu gốc là English nhưng người học muốn giải thích Việt.",
      "Sample document cũng sẽ bám theo ngôn ngữ bạn chọn.",
    ],
  },
  2: {
    eyebrow: "Mức độ nội dung",
    title: "Độ sâu của quiz và lời giải nên vừa sức",
    description:
      "Một bài giảng đại học và một tài liệu chứng chỉ chuyên nghiệp không nên cho ra cùng kiểu giải thích. Mức độ này giúp hệ thống chọn độ sâu hợp lý hơn.",
    highlight: "Setting này chỉ để cá nhân hóa cách giải thích, không gắn nhãn năng lực người học.",
    items: [
      "Question difficulty mix có thể điều chỉnh tốt hơn khi biết bối cảnh học của bạn.",
      "Tutor dễ chọn ví dụ minh họa gần với nền tảng hiện tại hơn.",
      "Sau này bạn vẫn có thể đổi bằng từng course hoặc từng document.",
    ],
  },
  3: {
    eyebrow: "First value",
    title: "Đi nhanh tới trải nghiệm bạn muốn thử đầu tiên",
    description:
      "Onboarding nên đưa người dùng tới giá trị đầu tiên thật nhanh, không biến thành form dài vô tận. Vì vậy bạn có thể upload ngay hoặc thử sample trước.",
    highlight: "Skippable nhưng vẫn recoverable: nếu bỏ qua lúc này, bạn luôn có thể quay lại từ Settings hoặc Home empty state.",
    items: [
      "Upload phù hợp khi bạn đã có PDF, note hoặc video muốn biến thành quiz ngay.",
      "Sample phù hợp khi bạn chỉ muốn xem citation, feedback và helper panels hoạt động ra sao.",
      "Cả hai đường đều giữ giọng điệu minh bạch về AI limitations.",
    ],
  },
  4: {
    eyebrow: "Trust first",
    title: "Citation phải rõ, AI limitations phải nói thẳng",
    description:
      "Mục tiêu của sản phẩm là biến tài liệu thành active learning, không phải tạo cảm giác AI biết mọi thứ. Bước này nhắc lại nguyên tắc đó trước khi bạn bắt đầu.",
    highlight: "Mỗi lời giải tốt đều nên nhảy được về nguồn hoặc thừa nhận khi không đủ bằng chứng.",
    items: [
      "Quiz, tutor và review cần hiển thị citation gần nội dung giải thích, không giấu đi.",
      "Khi AI không chắc, giao diện phải nói rõ thay vì trả lời tự tin mơ hồ.",
      "Bạn có thể xem lại nguyên tắc này sau trong Settings > Learning Preferences.",
    ],
  },
};

function waitForMockSubmit(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, SIMULATED_SUBMIT_MS);
  });
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
    errors.goal = "Chọn một mục tiêu chính để hệ thống gợi ý bước tiếp theo phù hợp hơn.";
  }

  if (stepIndex === 1 && !values.language) {
    errors.language = "Chọn ngôn ngữ ưu tiên cho quiz, tutor và helper copy.";
  }

  if (stepIndex === 2 && !values.level) {
    errors.level = "Chọn mức độ gần nhất với nhu cầu hiện tại của bạn.";
  }

  if (stepIndex === 3 && !values.firstAction) {
    errors.firstAction = "Chọn cách bạn muốn đi tới first value: upload thật hoặc sample document.";
  }

  if (stepIndex === 4 && !values.acceptsTrustNote) {
    errors.acceptsTrustNote =
      "Hãy xác nhận rằng bạn muốn kiểm tra đầu ra AI bằng citation nguồn khi cần.";
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
    `Mục tiêu ưu tiên: ${getGoalLabel(values.goal)}`,
    `Ngôn ngữ mặc định: ${getLanguageLabel(values.language)}`,
    `Mức độ giải thích: ${getLevelLabel(values.level)}`,
    `Đường tới first value: ${getFirstActionLabel(values.firstAction)}`,
  ] as const;
}

function getStepProgress(currentStep: number): number {
  return Math.round(((currentStep + 1) / onboardingSteps.length) * 100);
}

export function OnboardingFlow(): ReactNode {
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
    await waitForMockSubmit();
    setIsPending(false);
    setHasCompleted(true);
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
            Onboarding này ngắn, có thể bỏ qua, và luôn mở lại được trong Settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={routes.settings} variant="ghost" size="sm">
            Mở lại sau từ Settings
          </LinkButton>
          <LinkButton href={routes.home} variant="outline" size="sm">
            Bỏ qua lúc này
          </LinkButton>
        </div>
      </div>

      <MockModeNote />

      {hasCompleted ? (
        <AuthStatusMessage
          title="Onboarding mock đã hoàn tất"
          description="Bạn đã có đủ thiết lập để hệ thống chọn tông giải thích, kiểu quiz và đường tới first value hợp lý hơn ngay từ đầu."
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
                {values.firstAction === "sample" ? "Mở sample / Home mock" : "Đi tới upload mock"}
                <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={routes.settings} variant="outline" className="w-full sm:w-auto">
                Chỉnh lại preference trong Settings
              </LinkButton>
            </div>
          </div>
        </AuthStatusMessage>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-ink-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
              {onboardingSteps[currentStep].key}
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
                    Sample document preview
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf
                    </CardTitle>
                    <p className="text-sm leading-6 text-ink-600">
                      Sample này cho bạn thấy rõ một vòng hoàn chỉnh: document → quiz → explanation → citation → weak topic follow-up.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm text-ink-700">
                      5 câu hỏi active recall có lời giải và citation nguồn
                    </div>
                    <div className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm text-ink-700">
                      Weak topic được gợi ý lại để bạn biết phần nào nên review tiếp
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
                    <Badge tone="brand">Source-grounded workflow</Badge>
                    <CardTitle className="text-base">
                      Một vòng học đáng tin cậy nên trông như thế nào?
                    </CardTitle>
                    <p className="text-sm leading-6 text-ink-600">
                      Hệ thống biến document thành câu hỏi, nhưng giá trị thật nằm ở chỗ bạn trả lời, nhận feedback và có thể quay về nguồn để tự kiểm chứng.
                    </p>
                  </div>
                  <StepTimeline steps={buildSteps(6)} />
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
                    Tôi hiểu AI-generated quiz hoặc giải thích có thể chưa hoàn hảo, và tôi muốn luôn có citation nguồn để kiểm tra lại khi cần.
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

          <div className="flex flex-col gap-3 border-t border-ink-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={goBack} disabled={currentStep === 0 || isPending}>
                <ArrowLeft className="h-4 w-4" />
                Quay lại
              </Button>
              <Link href={routes.home} className="inline-flex items-center text-sm font-medium text-ink-500 hover:text-ink-700">
                Bỏ qua onboarding
              </Link>
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
                      Đang lưu preference mock…
                    </>
                  ) : (
                    <>
                      Hoàn tất onboarding
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
