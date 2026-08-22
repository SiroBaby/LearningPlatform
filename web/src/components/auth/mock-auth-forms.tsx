"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { Badge, Button, LinkButton, PasswordField, TextField } from "@/components/ui";
import { routes } from "@/lib/routes";
import {
  AuthHelperPanel,
  AuthStatusMessage,
  MockModeNote,
} from "./auth-primitives";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const SIMULATED_REQUEST_MS = 700;

function waitForMockRequest(durationMs: number = SIMULATED_REQUEST_MS): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function isEmailValid(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

function hasLetter(value: string): boolean {
  return /[A-Za-zÀ-ỹ]/.test(value);
}

function hasFieldErrors<T extends string>(errors: Partial<Record<T, string>>): boolean {
  return Object.values(errors).some(Boolean);
}

function focusFirstInvalidField(
  fieldIds: readonly string[],
  errors: Record<string, string | undefined>,
): void {
  const firstInvalidFieldId = fieldIds.find((fieldId) => Boolean(errors[fieldId]));

  if (!firstInvalidFieldId) {
    return;
  }

  document.getElementById(firstInvalidFieldId)?.focus();
}

function removeFieldError<T extends string>(
  errors: Partial<Record<T, string>>,
  field: T,
): Partial<Record<T, string>> {
  if (!errors[field]) {
    return errors;
  }

  const nextErrors = { ...errors };
  delete nextErrors[field];
  return nextErrors;
}

type LoginField = "email" | "password";

interface LoginValues {
  email: string;
  password: string;
  rememberMe: boolean;
}

const LOGIN_FIELD_ORDER = ["email", "password"] as const;

function validateLoginValues(values: LoginValues): Partial<Record<LoginField, string>> {
  const errors: Partial<Record<LoginField, string>> = {};

  if (!values.email.trim()) {
    errors.email = "Nhập email để tiếp tục.";
  } else if (!isEmailValid(values.email)) {
    errors.email = "Email chưa đúng định dạng.";
  }

  if (!values.password) {
    errors.password = "Nhập mật khẩu của bạn.";
  }

  return errors;
}

export function LoginForm(): ReactNode {
  const [values, setValues] = useState<LoginValues>({
    email: "",
    password: "",
    rememberMe: true,
  });
  const [errors, setErrors] = useState<Partial<Record<LoginField, string>>>({});
  const [isPending, setIsPending] = useState(false);
  const [hasSucceeded, setHasSucceeded] = useState(false);

  function updateValue<Key extends keyof LoginValues>(
    field: Key,
    value: LoginValues[Key],
  ): void {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));

    if (field === "email" || field === "password") {
      setErrors((currentErrors) => removeFieldError(currentErrors, field));
    }

    if (hasSucceeded) {
      setHasSucceeded(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = validateLoginValues(values);
    setErrors(nextErrors);
    setHasSucceeded(false);

    if (hasFieldErrors(nextErrors)) {
      focusFirstInvalidField(LOGIN_FIELD_ORDER, nextErrors);
      return;
    }

    setIsPending(true);
    await waitForMockRequest();
    setIsPending(false);
    setHasSucceeded(true);
  }

  return (
    <div className="space-y-5">
      <MockModeNote />

      {hasSucceeded ? (
        <AuthStatusMessage
          title="Đăng nhập mock thành công"
          description="Trong production, hệ thống sẽ đưa bạn về review queue hoặc quiz đang làm dở thay vì để bạn tìm thủ công."
          tone="success"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <LinkButton href={routes.home} className="w-full sm:w-auto">
              Đi tới Home mock <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.review} variant="outline" className="w-full sm:w-auto">
              Mở review queue
            </LinkButton>
          </div>
        </AuthStatusMessage>
      ) : null}

      <form className="space-y-4" aria-busy={isPending} onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email"
          type="email"
          value={values.email}
          error={errors.email}
          placeholder="ban@email.com"
          autoComplete="email"
          onChange={(event) => updateValue("email", event.target.value)}
        />
        <PasswordField
          id="password"
          label="Mật khẩu"
          value={values.password}
          error={errors.password}
          placeholder="Nhập mật khẩu"
          autoComplete="current-password"
          onChange={(event) => updateValue("password", event.target.value)}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={values.rememberMe}
              onChange={(event) => updateValue("rememberMe", event.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            Giữ phiên đăng nhập trên thiết bị này
          </label>
          <Link href={routes.forgotPassword} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Quên mật khẩu?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang kiểm tra email và mật khẩu…
            </>
          ) : (
            "Đăng nhập"
          )}
        </Button>
      </form>

      <AuthHelperPanel
        badge="Sau khi đăng nhập"
        title="Bạn sẽ quay lại đúng ngữ cảnh học"
        description="Luồng này ưu tiên cho người học quay về việc đang dở thay vì bắt đầu lại từ đầu."
        items={[
          "Review queue hôm nay và flashcard đến hạn sẽ hiện ngay ở Home.",
          "Quiz đang làm dở hoặc tài liệu vừa xử lý xong được đưa lên đầu.",
          "Mọi giải thích vẫn giữ citation nguồn để bạn tự kiểm chứng khi cần.",
        ]}
      />

      <p className="text-center text-sm text-ink-500">
        Chưa có tài khoản?{" "}
        <Link href={routes.signup} className="font-medium text-brand-700 hover:text-brand-800">
          Bắt đầu miễn phí
        </Link>
      </p>
    </div>
  );
}

type SignupField =
  | "fullName"
  | "email"
  | "password"
  | "confirmPassword"
  | "acceptsTrustNote";

interface SignupValues {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptsTrustNote: boolean;
}

const SIGNUP_FIELD_ORDER = [
  "fullName",
  "email",
  "password",
  "confirmPassword",
  "acceptsTrustNote",
] as const;

function validateSignupValues(
  values: SignupValues,
): Partial<Record<SignupField, string>> {
  const errors: Partial<Record<SignupField, string>> = {};

  if (values.fullName.trim().length < 2) {
    errors.fullName = "Nhập họ và tên để cá nhân hóa trải nghiệm học.";
  }

  if (!values.email.trim()) {
    errors.email = "Nhập email để tạo tài khoản.";
  } else if (!isEmailValid(values.email)) {
    errors.email = "Email chưa đúng định dạng.";
  }

  if (!values.password) {
    errors.password = "Tạo mật khẩu cho tài khoản mới.";
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  } else if (!hasLetter(values.password) || !hasDigit(values.password)) {
    errors.password = "Dùng cả chữ và số để mật khẩu dễ bảo vệ hơn.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Nhập lại mật khẩu để tránh gõ nhầm.";
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Mật khẩu xác nhận chưa khớp.";
  }

  if (!values.acceptsTrustNote) {
    errors.acceptsTrustNote =
      "Hãy xác nhận rằng bạn hiểu cần kiểm tra giải thích bằng citation nguồn khi cần.";
  }

  return errors;
}

export function SignupForm(): ReactNode {
  const [values, setValues] = useState<SignupValues>({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    acceptsTrustNote: false,
  });
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  const [isPending, setIsPending] = useState(false);
  const [hasSucceeded, setHasSucceeded] = useState(false);

  function updateValue<Key extends keyof SignupValues>(
    field: Key,
    value: SignupValues[Key],
  ): void {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));

    if (
      field === "fullName" ||
      field === "email" ||
      field === "password" ||
      field === "confirmPassword" ||
      field === "acceptsTrustNote"
    ) {
      setErrors((currentErrors) => removeFieldError(currentErrors, field));
    }

    if (hasSucceeded) {
      setHasSucceeded(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = validateSignupValues(values);
    setErrors(nextErrors);
    setHasSucceeded(false);

    if (hasFieldErrors(nextErrors)) {
      focusFirstInvalidField(SIGNUP_FIELD_ORDER, nextErrors);
      return;
    }

    setIsPending(true);
    await waitForMockRequest();
    setIsPending(false);
    setHasSucceeded(true);
  }

  return (
    <div className="space-y-5">
      <MockModeNote />

      {hasSucceeded ? (
        <AuthStatusMessage
          title="Tài khoản mock đã sẵn sàng"
          description="Bước tiếp theo hợp lý là xác minh email rồi chọn mục tiêu học đầu tiên để hệ thống gợi ý đúng kiểu review."
          tone="success"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <LinkButton href={routes.verifyEmail} className="w-full sm:w-auto">
              Sang bước xác minh email <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.onboarding} variant="outline" className="w-full sm:w-auto">
              Xem onboarding trước
            </LinkButton>
          </div>
        </AuthStatusMessage>
      ) : null}

      <form className="space-y-4" aria-busy={isPending} onSubmit={handleSubmit} noValidate>
        <TextField
          id="fullName"
          label="Họ và tên"
          value={values.fullName}
          error={errors.fullName}
          placeholder="Nguyễn Minh Anh"
          autoComplete="name"
          onChange={(event) => updateValue("fullName", event.target.value)}
        />
        <TextField
          id="email"
          label="Email"
          type="email"
          value={values.email}
          error={errors.email}
          placeholder="ban@email.com"
          autoComplete="email"
          onChange={(event) => updateValue("email", event.target.value)}
        />
        <PasswordField
          id="password"
          label="Mật khẩu"
          value={values.password}
          error={errors.password}
          hint="Tối thiểu 8 ký tự, nên có cả chữ và số."
          placeholder="Tạo mật khẩu"
          autoComplete="new-password"
          onChange={(event) => updateValue("password", event.target.value)}
        />
        <PasswordField
          id="confirmPassword"
          label="Xác nhận mật khẩu"
          value={values.confirmPassword}
          error={errors.confirmPassword}
          placeholder="Nhập lại mật khẩu"
          autoComplete="new-password"
          onChange={(event) => updateValue("confirmPassword", event.target.value)}
        />
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-ink-600">
            <input
              id="acceptsTrustNote"
              type="checkbox"
              checked={values.acceptsTrustNote}
              onChange={(event) => updateValue("acceptsTrustNote", event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              Tôi hiểu AI có thể sai và sẽ kiểm tra giải thích bằng citation nguồn khi cần.
            </span>
          </label>
          {errors.acceptsTrustNote ? (
            <p className="text-xs text-error-600">{errors.acceptsTrustNote}</p>
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tạo tài khoản…
            </>
          ) : (
            "Bắt đầu miễn phí"
          )}
        </Button>
      </form>

      <AuthHelperPanel
        badge="First value nhanh"
        title="Sau signup, người học không nên gặp dashboard trống"
        description="Luồng này dẫn thẳng sang email verification rồi onboarding ngắn để bạn tới upload hoặc sample document càng sớm càng tốt."
        items={[
          "Bạn có thể thử tài liệu mẫu nếu chưa có PDF hoặc video trong tay.",
          "Citation nguồn luôn hiện cạnh quiz và lời giải, không bị giấu dưới nhiều lớp click.",
          "Goal, language và level đều có thể đổi lại trong Settings sau này.",
        ]}
      />

      <p className="text-center text-sm text-ink-500">
        Đã có tài khoản?{" "}
        <Link href={routes.login} className="font-medium text-brand-700 hover:text-brand-800">
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}

type ForgotPasswordField = "email";

interface ForgotPasswordValues {
  email: string;
}

function validateForgotPasswordValues(
  values: ForgotPasswordValues,
): Partial<Record<ForgotPasswordField, string>> {
  const errors: Partial<Record<ForgotPasswordField, string>> = {};

  if (!values.email.trim()) {
    errors.email = "Nhập email đăng ký để nhận liên kết đặt lại.";
  } else if (!isEmailValid(values.email)) {
    errors.email = "Email chưa đúng định dạng.";
  }

  return errors;
}

export function ForgotPasswordForm(): ReactNode {
  const [values, setValues] = useState<ForgotPasswordValues>({ email: "" });
  const [errors, setErrors] = useState<Partial<Record<ForgotPasswordField, string>>>({});
  const [isPending, setIsPending] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = validateForgotPasswordValues(values);
    setErrors(nextErrors);
    setSentEmail(null);

    if (hasFieldErrors(nextErrors)) {
      focusFirstInvalidField(["email"], nextErrors);
      return;
    }

    setIsPending(true);
    await waitForMockRequest();
    setIsPending(false);
    setSentEmail(values.email.trim());
  }

  return (
    <div className="space-y-5">
      <MockModeNote />

      {sentEmail ? (
        <AuthStatusMessage
          title="Liên kết đặt lại đã được mô phỏng"
          description={`Nếu ${sentEmail} tồn tại trong hệ thống thật, email sẽ chứa liên kết đổi mật khẩu có hiệu lực khoảng 30 phút.`}
          tone="success"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <LinkButton href={routes.resetPassword} className="w-full sm:w-auto">
              Xem màn hình đặt lại mật khẩu <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setSentEmail(null)}>
              Gửi lại lần nữa
            </Button>
          </div>
        </AuthStatusMessage>
      ) : null}

      <form className="space-y-4" aria-busy={isPending} onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email"
          type="email"
          value={values.email}
          error={errors.email}
          placeholder="ban@email.com"
          autoComplete="email"
          onChange={(event) => {
            setValues({ email: event.target.value });
            setErrors((currentErrors) => removeFieldError(currentErrors, "email"));
          }}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang chuẩn bị liên kết đặt lại…
            </>
          ) : (
            "Gửi liên kết đặt lại"
          )}
        </Button>
      </form>

      <AuthHelperPanel
        badge="Recovery flow"
        title="Giúp người dùng không bị kẹt ở bước quên mật khẩu"
        description="Ngay cả khi backend chưa nối thật, màn hình vẫn cần giải thích rõ điều gì sẽ xảy ra tiếp theo."
        items={[
          "Nếu không thấy email, hãy kiểm tra Spam hoặc Promotions trước khi thử lại.",
          "Liên kết đặt lại nên có thời hạn rõ ràng để tránh cảm giác rủi ro mơ hồ.",
          "Sau khi đổi mật khẩu, người dùng nên được quay về login hoặc thẳng vào flow đang dở.",
        ]}
      />

      <div className="flex flex-wrap gap-3 text-sm text-ink-500">
        <Link href={routes.login} className="font-medium text-brand-700 hover:text-brand-800">
          Quay lại đăng nhập
        </Link>
        <span aria-hidden>•</span>
        <Link href={routes.signup} className="font-medium text-brand-700 hover:text-brand-800">
          Tạo tài khoản mới
        </Link>
      </div>
    </div>
  );
}

type ResetPasswordField = "password" | "confirmPassword";

interface ResetPasswordValues {
  password: string;
  confirmPassword: string;
}

function validateResetPasswordValues(
  values: ResetPasswordValues,
): Partial<Record<ResetPasswordField, string>> {
  const errors: Partial<Record<ResetPasswordField, string>> = {};

  if (!values.password) {
    errors.password = "Nhập mật khẩu mới.";
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Mật khẩu mới cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  } else if (!hasLetter(values.password) || !hasDigit(values.password)) {
    errors.password = "Thêm cả chữ và số để mật khẩu an toàn hơn.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Nhập lại mật khẩu mới.";
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Mật khẩu xác nhận chưa khớp.";
  }

  return errors;
}

function getPasswordStrength(
  value: string,
): { label: string; tone: "neutral" | "warning" | "success" } {
  if (!value) {
    return { label: "Chưa nhập", tone: "neutral" };
  }

  if (value.length >= 10 && hasLetter(value) && hasDigit(value)) {
    return { label: "Khá tốt", tone: "success" };
  }

  return { label: "Cần mạnh hơn", tone: "warning" };
}

export function ResetPasswordForm(): ReactNode {
  const [values, setValues] = useState<ResetPasswordValues>({
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Partial<Record<ResetPasswordField, string>>>({});
  const [isPending, setIsPending] = useState(false);
  const [hasSucceeded, setHasSucceeded] = useState(false);

  const passwordStrength = getPasswordStrength(values.password);

  function updateValue<Key extends keyof ResetPasswordValues>(
    field: Key,
    value: ResetPasswordValues[Key],
  ): void {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
    setErrors((currentErrors) => removeFieldError(currentErrors, field));

    if (hasSucceeded) {
      setHasSucceeded(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = validateResetPasswordValues(values);
    setErrors(nextErrors);
    setHasSucceeded(false);

    if (hasFieldErrors(nextErrors)) {
      focusFirstInvalidField(["password", "confirmPassword"], nextErrors);
      return;
    }

    setIsPending(true);
    await waitForMockRequest();
    setIsPending(false);
    setHasSucceeded(true);
  }

  return (
    <div className="space-y-5">
      <MockModeNote />

      {hasSucceeded ? (
        <AuthStatusMessage
          title="Mật khẩu mock đã được cập nhật"
          description="Ở bản production, các phiên nhạy cảm có thể bị yêu cầu đăng nhập lại để bảo vệ tài khoản của bạn."
          tone="success"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <LinkButton href={routes.login} className="w-full sm:w-auto">
              Quay lại đăng nhập <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <LinkButton href={routes.home} variant="outline" className="w-full sm:w-auto">
              Vào Home mock
            </LinkButton>
          </div>
        </AuthStatusMessage>
      ) : null}

      <form className="space-y-4" aria-busy={isPending} onSubmit={handleSubmit} noValidate>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-ink-700">
            <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden />
            Độ mạnh mật khẩu
          </div>
          <Badge tone={passwordStrength.tone}>{passwordStrength.label}</Badge>
        </div>
        <PasswordField
          id="password"
          label="Mật khẩu mới"
          value={values.password}
          error={errors.password}
          hint="Nên dùng cụm mật khẩu dễ nhớ với cả chữ và số."
          placeholder="Tạo mật khẩu mới"
          autoComplete="new-password"
          onChange={(event) => updateValue("password", event.target.value)}
        />
        <PasswordField
          id="confirmPassword"
          label="Xác nhận mật khẩu"
          value={values.confirmPassword}
          error={errors.confirmPassword}
          placeholder="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          onChange={(event) => updateValue("confirmPassword", event.target.value)}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang lưu mật khẩu mới…
            </>
          ) : (
            "Lưu mật khẩu mới"
          )}
        </Button>
      </form>

      <AuthHelperPanel
        badge="Security note"
        title="Mật khẩu mới không nên làm người dùng đoán mò"
        description="Màn hình đặt lại cần cân bằng giữa rõ ràng và an toàn: hướng dẫn đủ cụ thể, nhưng không tạo cảm giác lỗi mơ hồ."
        items={[
          "Nói rõ tiêu chí tối thiểu ngay gần trường mật khẩu, không đợi submit mới báo hết mọi lỗi.",
          "Giữ nút submit luôn nhìn thấy được; chỉ khóa tạm trong lúc đang xử lý thật sự.",
          "Sau khi đổi xong, cho người dùng đường quay lại login hoặc flow đang học.",
        ]}
      />
    </div>
  );
}

export function VerifyEmailPanel(): ReactNode {
  const [isResending, setIsResending] = useState(false);
  const [hasResent, setHasResent] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  async function handleResend(): Promise<void> {
    setIsResending(true);
    setHasResent(false);
    await waitForMockRequest();
    setIsResending(false);
    setHasResent(true);
  }

  return (
    <div className="space-y-5">
      <MockModeNote />

      <AuthStatusMessage
        title={isConfirmed ? "Email đã được xác minh" : "Kiểm tra hộp thư của bạn"}
        description={
          isConfirmed
            ? "Bạn đã hoàn tất bước xác minh mock. Bây giờ hệ thống có thể đưa bạn sang onboarding hoặc upload đầu tiên."
            : "Chúng tôi đã gửi email xác minh đến hocvien@learningplatform.demo. Hãy mở email và nhấn vào liên kết để tiếp tục."
        }
        tone={isConfirmed ? "success" : "info"}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          {isConfirmed ? (
            <LinkButton href={routes.onboarding} className="w-full sm:w-auto">
              Tiếp tục onboarding <ArrowRight className="h-4 w-4" />
            </LinkButton>
          ) : (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setIsConfirmed(true)}>
              <CheckCircle2 className="h-4 w-4" />
              Tôi đã mở liên kết xác minh
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={isResending}
            onClick={() => {
              void handleResend();
            }}
          >
            {isResending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang gửi lại…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" />
                Gửi lại email
              </>
            )}
          </Button>
        </div>
        {hasResent ? (
          <p className="text-sm text-success-700">
            Email xác minh mock đã được gửi lại. Nếu hộp thư chính không có, hãy kiểm tra Spam hoặc Promotions.
          </p>
        ) : null}
      </AuthStatusMessage>

      <AuthHelperPanel
        badge="Vì sao cần bước này"
        title="Xác minh email trước khi upload tài liệu"
        description="Đây là nơi người dùng hiểu rõ tài khoản được bảo vệ ra sao và họ sẽ nhận thông báo gì khi tài liệu sẵn sàng."
        items={[
          "Nhận thông báo khi document xử lý xong hoặc khi review queue đến hạn.",
          "Giảm rủi ro mất quyền truy cập nếu quên mật khẩu hoặc đổi thiết bị.",
          "Bạn luôn có thể đổi email sau này trong phần Account Settings.",
        ]}
      />

      <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4 text-sm text-ink-600">
        <div className="flex items-center gap-2 font-medium text-ink-800">
          <TimerReset className="h-4 w-4 text-brand-600" aria-hidden />
          Mẹo nếu chưa thấy email
        </div>
        <ul className="mt-3 space-y-2 leading-6">
          <li>Kiểm tra đúng địa chỉ email vừa đăng ký và cả thư mục Spam.</li>
          <li>Nếu dùng email trường học/công ty, mail xác minh có thể chậm vài phút.</li>
          <li>Không nhận được vẫn có thể quay lại signup để sửa email trước khi upload.</li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-ink-500">
        <Link href={routes.signup} className="font-medium text-brand-700 hover:text-brand-800">
          Dùng email khác
        </Link>
        <span aria-hidden>•</span>
        <Link href={routes.login} className="font-medium text-brand-700 hover:text-brand-800">
          Quay lại đăng nhập
        </Link>
      </div>
    </div>
  );
}
