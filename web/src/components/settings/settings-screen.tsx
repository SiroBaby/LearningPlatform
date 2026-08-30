"use client";

import { useEffect, useState } from "react";
import { Accessibility, Bell, Eye, Globe2, Shield, Sparkles, Trash2 } from "lucide-react";
import { courses, usage } from "@/lib/mock-data";
import { Button, Card, CardBody, CardHeader, CardTitle, LinkButton, SelectField, Tabs, TextField, useToast } from "@/components/ui";
import { routes } from "@/lib/routes";

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
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [language, setLanguage] = useState("Tiếng Việt");
  const [explanationStyle, setExplanationStyle] = useState("Ngắn gọn + có ví dụ");
  const [difficulty, setDifficulty] = useState("Tự điều chỉnh");
  const [reviewSchedule, setReviewSchedule] = useState("Buổi tối");
  const [examGoal, setExamGoal] = useState(courses[0]?.goal ?? "Đạt A cuối kỳ");
  const [defaultOutputs, setDefaultOutputs] = useState("Bài kiểm tra · Thẻ ghi nhớ · Trợ giảng");
  const [isInAppEnabled, setIsInAppEnabled] = useState(true);
  const [isEmailEnabled, setIsEmailEnabled] = useState(true);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isPrivateByDefault, setIsPrivateByDefault] = useState(true);
  const [isTrainingOptOut, setIsTrainingOptOut] = useState(true);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [isLargeText, setIsLargeText] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isCaptionsByDefault, setIsCaptionsByDefault] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const planLabel = usage.planLabel === "Free" ? "Miễn phí" : usage.planLabel;

  useEffect(() => {
    let active = true;
    void fetch("/auth/me", { cache: "no-store" })
      .then(async (response) => (response.ok ? (await response.json()) as { displayName?: string | null; email?: string; role?: string } : null))
      .then((user) => {
        if (!active || !user) return;
        setFullName(user.displayName ?? "");
        setEmail(user.email ?? "");
        setRole(user.role ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function saveSettings(): Promise<void> {
    setIsSavingProfile(true);
    try {
      const response = await fetch("/auth/profile", {
        body: JSON.stringify({ displayName: fullName }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error("profile update failed");
      notify("Đã lưu thông tin tài khoản.", "success");
    } catch {
      notify("Không thể lưu thông tin tài khoản. Vui lòng thử lại.", "error");
    } finally {
      setIsSavingProfile(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Globe2 className="h-4 w-4 text-brand-600" />
              Ngôn ngữ học tập
            </div>
            <p className="text-2xl font-semibold text-ink-900">{language}</p>
            <p className="text-sm text-ink-600">Ưu tiên hiển thị lời giải và gợi ý ôn tập theo ngôn ngữ bạn chọn.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Bell className="h-4 w-4 text-review-600" />
              Thông báo
            </div>
            <p className="text-2xl font-semibold text-ink-900">2/3</p>
            <p className="text-sm text-ink-600">Thông báo trong ứng dụng và email đang bật để bạn không bỏ lỡ lượt ôn đến hạn.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Shield className="h-4 w-4 text-success-600" />
              Quyền riêng tư mặc định
            </div>
            <p className="text-2xl font-semibold text-ink-900">Riêng tư</p>
            <p className="text-sm text-ink-600">Tài liệu đã tải lên chỉ mình bạn nhìn thấy theo mặc định.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <Accessibility className="h-4 w-4 text-warning-700" />
              Khả năng tiếp cận
            </div>
            <p className="text-2xl font-semibold text-ink-900">Có thể tùy chỉnh</p>
            <p className="text-sm text-ink-600">Bạn có thể điều chỉnh chuyển động, cỡ chữ, độ tương phản và phụ đề.</p>
          </CardBody>
        </Card>
      </section>

      <Tabs
        items={[
          {
            id: "account",
            label: "Tài khoản",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Thông tin và bảo mật</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Kiểm tra thông tin tài khoản, email đăng nhập và tài khoản Google đang kết nối.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField
                        id="full-name"
                        label="Tên hiển thị"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                      />
                      <TextField id="email" label="Email" value={email} readOnly />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField id="connected-accounts" label="Tài khoản đã kết nối" value="Google" readOnly />
                      <TextField id="account-role" label="Vai trò" value={role ?? "Đang tải"} readOnly />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void saveSettings()} disabled={isSavingProfile}>
                        {isSavingProfile ? "Đang lưu…" : "Lưu thay đổi tài khoản"}
                      </Button>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>An toàn tài khoản</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Tài liệu của bạn được giữ riêng tư; bạn có thể yêu cầu xuất dữ liệu hoặc đóng tài khoản.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="rounded-2xl border border-success-100 bg-success-50 p-4 text-sm leading-6 text-success-800">
                      Email của bạn đã được xác minh. Thông báo trong ứng dụng và email sẽ tiếp tục hoạt động cho đến khi bạn tắt.
                    </div>
                    <div className="rounded-2xl border border-ink-100 p-4">
                      <p className="text-sm font-semibold text-ink-900">Gói hiện tại</p>
                      <p className="mt-1 text-sm text-ink-600">{planLabel}</p>
                    </div>
                    <div className="rounded-2xl border border-error-100 bg-error-50 p-4">
                      <p className="text-sm font-semibold text-error-800">Đóng tài khoản</p>
                      <p className="mt-1 text-sm leading-6 text-error-800/90">
                        Đóng tài khoản sẽ ngừng quyền truy cập và ẩn thông tin của bạn khỏi các màn hình dành cho người học. Bài làm, tài liệu và lịch sử học được giữ theo chính sách lưu trữ; hãy xuất dữ liệu trước nếu cần.
                      </p>
                      <Button variant="danger" className="mt-4">
                        <Trash2 className="h-4 w-4" />
                        Đóng tài khoản
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "learning",
            label: "Tùy chọn học tập",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Cách bạn muốn học</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Những lựa chọn này giúp điều chỉnh độ khó bài kiểm tra, cách giải thích và kế hoạch ôn tập.
                    </p>
                    <LinkButton
                      href={routes.onboarding}
                      variant="outline"
                      size="sm"
                      className="mt-3"
                    >
                      <Sparkles className="h-4 w-4" />
                      Thiết lập lại cách học
                    </LinkButton>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField id="language" label="Ngôn ngữ ưu tiên" value={language} onChange={(event) => setLanguage(event.target.value)}>
                        <option>Tiếng Việt</option>
                        <option>English</option>
                        <option>Song ngữ</option>
                      </SelectField>
                      <SelectField id="difficulty" label="Độ khó ưu tiên" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                        <option>Tự điều chỉnh</option>
                        <option>Dễ trước</option>
                        <option>Chỉ mức độ thi</option>
                      </SelectField>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField id="explanation-style" label="Cách giải thích" value={explanationStyle} onChange={(event) => setExplanationStyle(event.target.value)}>
                        <option>Ngắn gọn + có ví dụ</option>
                        <option>Chi tiết từng bước</option>
                        <option>So sánh khái niệm</option>
                      </SelectField>
                      <SelectField id="review-schedule" label="Lịch ôn tập" value={reviewSchedule} onChange={(event) => setReviewSchedule(event.target.value)}>
                        <option>Buổi tối</option>
                        <option>Buổi sáng</option>
                        <option>Linh hoạt</option>
                      </SelectField>
                    </div>
                    <TextField id="exam-goal" label="Mục tiêu kỳ thi" value={examGoal} onChange={(event) => setExamGoal(event.target.value)} />
                    <TextField id="default-outputs" label="Nội dung tạo mặc định" value={defaultOutputs} onChange={(event) => setDefaultOutputs(event.target.value)} />
                    <Button onClick={saveSettings}>Lưu tùy chọn học tập</Button>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Những lựa chọn này giúp gì cho bạn?</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Các lựa chọn này sẽ thay đổi cách bạn nhận lời giải và sắp xếp việc ôn tập hằng ngày.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-5 w-5 text-brand-700" />
                        <div>
                          <p className="text-sm font-semibold text-brand-800">Cách giải thích thay đổi trợ giảng và kết quả</p>
                          <p className="mt-1 text-sm leading-6 text-brand-800/90">
                            Nếu bạn chọn “Chi tiết từng bước”, phần kết quả và trợ giảng sẽ ưu tiên giải thích dài hơn, có thêm ví dụ và dẫn nguồn.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-review-100 bg-review-50 p-4 text-sm leading-6 text-review-700">
                      Lịch ôn tập giúp chọn thời điểm nhắc phù hợp. Nếu thường học bằng điện thoại, một phiên ngắn buổi tối có thể dễ duy trì hơn.
                    </div>
                    <div className="rounded-2xl border border-ink-100 p-4">
                      <p className="text-sm font-semibold text-ink-900">Mục tiêu hiện tại</p>
                      <p className="mt-2 text-sm leading-6 text-ink-600">{examGoal}</p>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "notifications-privacy",
            label: "Thông báo và riêng tư",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Cách nhận thông báo</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Chọn cách bạn nhận thông báo về lượt ôn đến hạn, tài liệu sẵn sàng và chủ đề cần củng cố.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <ToggleField
                      id="in-app"
                      label="Thông báo trong ứng dụng"
                      description="Bật để xem tài liệu sẵn sàng, chủ đề cần củng cố hoặc xử lý chưa thành công ngay trong ứng dụng."
                      checked={isInAppEnabled}
                      onChange={setIsInAppEnabled}
                    />
                    <ToggleField
                      id="email"
                      label="Thông báo qua email"
                      description="Nhận nhắc lượt ôn đến hạn hoặc vấn đề thanh toán ngay cả khi không mở ứng dụng."
                      checked={isEmailEnabled}
                      onChange={setIsEmailEnabled}
                    />
                    <ToggleField
                      id="push"
                      label="Thông báo đẩy"
                      description="Dành cho điện thoại và ứng dụng đã cài. Tắt nếu bạn chỉ muốn xem trong ứng dụng hoặc email."
                      checked={isPushEnabled}
                      onChange={setIsPushEnabled}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Quyền riêng tư và dữ liệu</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Kiểm soát quyền riêng tư của tài liệu và cách dữ liệu được sử dụng.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <ToggleField
                      id="private-docs"
                      label="Tài liệu riêng tư mặc định"
                      description="Tài liệu tải lên chỉ mình bạn nhìn thấy cho đến khi chủ động chia sẻ trong lớp học hoặc xuất dữ liệu."
                      checked={isPrivateByDefault}
                      onChange={setIsPrivateByDefault}
                    />
                    <ToggleField
                      id="training-opt-out"
                      label="Không dùng dữ liệu của tôi để huấn luyện mô hình"
                      description="Bạn có thể chủ động từ chối việc dùng dữ liệu cho huấn luyện thay vì phải tìm trong điều khoản dài."
                      checked={isTrainingOptOut}
                      onChange={setIsTrainingOptOut}
                    />
                    <div className="rounded-2xl border border-ink-100 p-4 text-sm leading-6 text-ink-600">
                      Việc xuất dữ liệu và xóa nội dung đã tạo cần dễ tìm. Các nút này hiện chỉ minh họa giao diện, chưa thực hiện thao tác thật.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline">
                        <Eye className="h-4 w-4" />
                        Xuất dữ liệu của tôi
                      </Button>
                      <Button variant="outline">
                        Xóa nội dung đã tạo
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "accessibility",
            label: "Khả năng tiếp cận",
            content: (
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Tùy chọn khả năng tiếp cận</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Các tùy chọn này giúp bạn đọc và tương tác với bài kiểm tra, trợ giảng, biểu đồ và video dễ hơn.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <ToggleField
                      id="reduced-motion"
                      label="Giảm chuyển động"
                      description="Giảm chuyển động trong vòng tiến độ, thông báo và chuyển cảnh."
                      checked={isReducedMotion}
                      onChange={setIsReducedMotion}
                    />
                    <ToggleField
                      id="large-text"
                      label="Chữ lớn hơn"
                      description="Tăng cỡ chữ cho câu hỏi, lời giải và trích dẫn nguồn."
                      checked={isLargeText}
                      onChange={setIsLargeText}
                    />
                    <ToggleField
                      id="high-contrast"
                      label="Độ tương phản cao"
                      description="Tăng tương phản cho chữ, đường viền và nhãn trạng thái."
                      checked={isHighContrast}
                      onChange={setIsHighContrast}
                    />
                    <ToggleField
                      id="captions"
                      label="Luôn bật phụ đề và bản chép lời"
                      description="Mở sẵn bản chép lời và phụ đề cho video học tập."
                      checked={isCaptionsByDefault}
                      onChange={setIsCaptionsByDefault}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Lưu ý về khả năng tiếp cận</CardTitle>
                    <p className="mt-1 text-sm text-ink-600">
                      Các điều chỉnh này giúp giao diện phù hợp hơn với cách bạn đọc và học.
                    </p>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div className="rounded-2xl border border-success-100 bg-success-50 p-4 text-sm leading-6 text-success-800">
                      Biểu đồ vẫn có phần tóm tắt bằng chữ ngay cả khi bạn bật độ tương phản cao hoặc giảm chuyển động.
                    </div>
                    <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
                      Video sẽ nhớ lựa chọn phụ đề và bản chép lời để bạn không phải bật lại mỗi lần mở tài liệu.
                    </div>
                    <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-800">
                      Khi bật chữ lớn, giao diện vẫn cần hiển thị trọn nhãn, tên tài liệu dài và thanh điều hướng trên điện thoại.
                    </div>
                    <Button onClick={saveSettings}>Lưu tùy chọn khả năng tiếp cận</Button>
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
