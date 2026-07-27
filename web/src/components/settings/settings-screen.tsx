"use client";

import { useState } from "react";
import { Accessibility, Bell, Eye, Globe2, Lock, Shield, Sparkles, Trash2 } from "lucide-react";
import { courses, usage } from "@/lib/mock-data";
import { Button, Card, CardBody, CardHeader, CardTitle, SelectField, Tabs, TextField, useToast } from "@/components/ui";

interface ToggleFieldProps {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

function ToggleField({ id, label, description, checked, onChange }: ToggleFieldProps) {
  return (
    <label htmlFor={id} className="flex items-start justify-between gap-4 rounded-2xl border border-ink-100 p-4">
      <div>
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        <p className="mt-1 text-sm leading-6 text-ink-600">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand-600" : "bg-ink-200"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}

export function SettingsScreen() {
  const { notify } = useToast();
  const [fullName, setFullName] = useState("Ngọc Phát");
  const [email] = useState("phat@example.com");
  const [language, setLanguage] = useState("Tiếng Việt");
  const [explanationStyle, setExplanationStyle] = useState("Ngắn gọn + có ví dụ");
  const [difficulty, setDifficulty] = useState("Adaptive");
  const [reviewSchedule, setReviewSchedule] = useState("Buổi tối");
  const [examGoal, setExamGoal] = useState(courses[0]?.goal ?? "Đạt A cuối kỳ");
  const [defaultOutputs, setDefaultOutputs] = useState("Quiz · Flashcards · Tutor");
  const [isInAppEnabled, setIsInAppEnabled] = useState(true);
  const [isEmailEnabled, setIsEmailEnabled] = useState(true);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isPrivateByDefault, setIsPrivateByDefault] = useState(true);
  const [isTrainingOptOut, setIsTrainingOptOut] = useState(true);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [isLargeText, setIsLargeText] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isCaptionsByDefault, setIsCaptionsByDefault] = useState(true);

  function saveSettings(): void {
    notify("Đã lưu mock settings. UI này mô phỏng luồng cấu hình mà chưa ghi backend thật.", "success");
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Globe2 className="h-4 w-4 text-brand-600" />
              Learning language
            </div>
            <p className="text-2xl font-semibold text-ink-900">{language}</p>
            <p className="text-sm text-ink-600">Ưu tiên hiển thị explanation và gợi ý ôn tập theo ngôn ngữ bạn chọn.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Bell className="h-4 w-4 text-review-600" />
              Notifications
            </div>
            <p className="text-2xl font-semibold text-ink-900">2/3</p>
            <p className="text-sm text-ink-600">In-app và email đang bật để không bỏ lỡ review due hoặc credit warning.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Shield className="h-4 w-4 text-success-600" />
              Privacy default
            </div>
            <p className="text-2xl font-semibold text-ink-900">Private</p>
            <p className="text-sm text-ink-600">Uploaded documents là private theo mặc định, phù hợp với promise về trust trong sản phẩm.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Accessibility className="h-4 w-4 text-warning-700" />
              Accessibility
            </div>
            <p className="text-2xl font-semibold text-ink-900">Customizable</p>
            <p className="text-sm text-ink-600">Reduced motion, larger text, high contrast và captions có thể điều chỉnh riêng.</p>
          </CardBody>
        </Card>
      </section>

      <Tabs
        items={[
          {
            id: "account",
            label: "Account",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile & security</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Người học cần thấy rõ thông tin tài khoản, email đăng nhập và các connected accounts đang dùng.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField
                        id="full-name"
                        label="Name"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                      />
                      <TextField id="email" label="Email" value={email} readOnly />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField id="password" label="Password" type="password" value="password" readOnly />
                      <TextField id="connected-accounts" label="Connected accounts" value="Google" readOnly />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={saveSettings}>Save account changes</Button>
                      <Button variant="outline">
                        <Lock className="h-4 w-4" />
                        Change password
                      </Button>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Account safety</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Settings nên nhắc lại trust promise: tài liệu private, có quyền export và quyền xóa.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="rounded-2xl border border-success-100 bg-success-50 p-4 text-sm leading-6 text-success-800">
                      Email của bạn đã được xác minh. In-app alerts và email alerts sẽ tiếp tục hoạt động cho đến khi bạn tắt chúng.
                    </div>
                    <div className="rounded-2xl border border-ink-100 p-4">
                      <p className="text-sm font-semibold text-ink-900">Current plan</p>
                      <p className="mt-1 text-sm text-ink-600">{usage.planLabel}</p>
                    </div>
                    <div className="rounded-2xl border border-error-100 bg-error-50 p-4">
                      <p className="text-sm font-semibold text-error-800">Delete account</p>
                      <p className="mt-1 text-sm leading-6 text-error-800/90">
                        Xóa tài khoản sẽ gỡ document, generated outputs và lịch sử attempt. Nên có bước xác nhận mạnh hoặc export data trước khi thực hiện.
                      </p>
                      <Button variant="danger" className="mt-4">
                        <Trash2 className="h-4 w-4" />
                        Delete account
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "learning",
            label: "Learning preferences",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Study preferences</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Những cấu hình này ảnh hưởng trực tiếp tới quiz difficulty, explanation style và study plan ưu tiên.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField id="language" label="Preferred language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                        <option>Tiếng Việt</option>
                        <option>English</option>
                        <option>Mixed</option>
                      </SelectField>
                      <SelectField id="difficulty" label="Difficulty preference" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                        <option>Adaptive</option>
                        <option>Easy first</option>
                        <option>Exam-level only</option>
                      </SelectField>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField id="explanation-style" label="Explanation style" value={explanationStyle} onChange={(event) => setExplanationStyle(event.target.value)}>
                        <option>Ngắn gọn + có ví dụ</option>
                        <option>Chi tiết từng bước</option>
                        <option>So sánh khái niệm</option>
                      </SelectField>
                      <SelectField id="review-schedule" label="Review schedule" value={reviewSchedule} onChange={(event) => setReviewSchedule(event.target.value)}>
                        <option>Buổi tối</option>
                        <option>Buổi sáng</option>
                        <option>Linh hoạt</option>
                      </SelectField>
                    </div>
                    <TextField id="exam-goal" label="Exam goal" value={examGoal} onChange={(event) => setExamGoal(event.target.value)} />
                    <TextField id="default-outputs" label="Default generation outputs" value={defaultOutputs} onChange={(event) => setDefaultOutputs(event.target.value)} />
                    <Button onClick={saveSettings}>Save learning preferences</Button>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Why these settings matter</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Learner cần hiểu settings không chỉ là form, mà sẽ tác động thế nào đến workflow thực tế.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-5 w-5 text-brand-700" />
                        <div>
                          <p className="text-sm font-semibold text-brand-800">Explanation style changes tutor and result tone</p>
                          <p className="mt-1 text-sm leading-6 text-brand-800/90">
                            Nếu bạn chọn “Chi tiết từng bước”, result review và tutor replies nên ưu tiên breakdown dài hơn, có thêm ví dụ và nhắc lại citation.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-review-100 bg-review-50 p-4 text-sm leading-6 text-review-700">
                      Review schedule giúp study plan chọn thời điểm nhắc phù hợp. Với mobile-heavy learners, nhịp tối thường hiệu quả hơn vì dễ làm flashcards và retry quiz ngắn.
                    </div>
                    <div className="rounded-2xl border border-ink-100 p-4">
                      <p className="text-sm font-semibold text-ink-900">Current goal</p>
                      <p className="mt-2 text-sm leading-6 text-ink-600">{examGoal}</p>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "notifications-privacy",
            label: "Notifications & privacy",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Delivery preferences</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Kiểm soát cách learner nhận alert về review due, document ready, weak topic hoặc credit low.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <ToggleField
                      id="in-app"
                      label="In-app notifications"
                      description="Giữ bật để thấy document ready, weak topic detected và processing failed ngay trong learner shell."
                      checked={isInAppEnabled}
                      onChange={setIsInAppEnabled}
                    />
                    <ToggleField
                      id="email"
                      label="Email notifications"
                      description="Nhận nhắc review due hoặc payment issue ngay cả khi không mở app."
                      checked={isEmailEnabled}
                      onChange={setIsEmailEnabled}
                    />
                    <ToggleField
                      id="push"
                      label="Push notifications"
                      description="Dành cho mobile/PWA. Tắt nếu bạn chỉ muốn xem trong app hoặc email."
                      checked={isPushEnabled}
                      onChange={setIsPushEnabled}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Privacy & data</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Người học cần thấy rõ quyền kiểm soát document, generated outputs và policy liên quan dữ liệu AI.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <ToggleField
                      id="private-docs"
                      label="Private documents by default"
                      description="Tài liệu upload sẽ chỉ bạn nhìn thấy cho đến khi chủ động chia sẻ trong classroom hoặc export."
                      checked={isPrivateByDefault}
                      onChange={setIsPrivateByDefault}
                    />
                    <ToggleField
                      id="training-opt-out"
                      label="Do not use my data for model training"
                      description="Hiển thị rõ policy và để người dùng chủ động opt-out thay vì ẩn trong legal copy."
                      checked={isTrainingOptOut}
                      onChange={setIsTrainingOptOut}
                    />
                    <div className="rounded-2xl border border-ink-100 p-4 text-sm leading-6 text-ink-600">
                      Export data và delete generated outputs nên là action rõ ràng, không bị chôn trong menu sâu. Với mock UI này, chúng được trình bày như policy-ready surfaces chứ chưa chạy thật.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline">
                        <Eye className="h-4 w-4" />
                        Export my data
                      </Button>
                      <Button variant="outline">
                        Delete generated outputs
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "accessibility",
            label: "Accessibility",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Accessibility preferences</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Các tùy chọn này giúp learner dùng quiz, tutor, charts và video checkpoint dễ hơn trên nhiều bối cảnh.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <ToggleField
                      id="reduced-motion"
                      label="Reduced motion"
                      description="Giảm animation trong progress rings, toasts và panel transitions."
                      checked={isReducedMotion}
                      onChange={setIsReducedMotion}
                    />
                    <ToggleField
                      id="large-text"
                      label="Larger text"
                      description="Tăng cỡ chữ mặc định cho stem câu hỏi, explanation và citation snippets."
                      checked={isLargeText}
                      onChange={setIsLargeText}
                    />
                    <ToggleField
                      id="high-contrast"
                      label="High contrast"
                      description="Tăng tương phản cho text, borders và các chip trạng thái."
                      checked={isHighContrast}
                      onChange={setIsHighContrast}
                    />
                    <ToggleField
                      id="captions"
                      label="Captions and transcripts by default"
                      description="Mở transcript/captions sẵn cho video checkpoint và media study flows."
                      checked={isCaptionsByDefault}
                      onChange={setIsCaptionsByDefault}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Accessibility notes</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Mục này giải thích UI nên phản ứng ra sao khi người dùng thay đổi tùy chọn.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="rounded-2xl border border-success-100 bg-success-50 p-4 text-sm leading-6 text-success-800">
                      Charts vẫn phải giữ text summaries ngay cả khi high contrast hoặc reduced motion được bật. Đây là non-negotiable của analytics surfaces.
                    </div>
                    <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
                      Video checkpoint nên nhớ lựa chọn captions/transcript default để learner không phải bật lại mỗi lần mở media document mới.
                    </div>
                    <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-800">
                      Khi larger text bật, layout phải tránh overflow ở chips, document titles dài và bottom navigation trên mobile.
                    </div>
                    <Button onClick={saveSettings}>Save accessibility preferences</Button>
                  </CardBody>
                </Card>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
