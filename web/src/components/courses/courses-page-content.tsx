"use client";

import { useMemo, useState } from "react";
import { FileStack, GraduationCap, PlusCircle } from "lucide-react";
import { formatDate } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Course, LearningDocument } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  LinkButton,
  ProgressBar,
  SectionHeading,
  SelectField,
  TextField,
  useToast,
} from "@/components/ui";

const OUTPUT_LABELS = {
  quiz: "Bài kiểm tra",
  flashcards: "Thẻ ghi nhớ",
  tutor: "Trợ giảng",
  checkpoints: "Điểm dừng",
} as const;

function getOutputLabels(outputs: ReadonlyArray<keyof typeof OUTPUT_LABELS>): string {
  return outputs.map((output) => OUTPUT_LABELS[output]).join(", ");
}

interface CreateCourseFormState {
  readonly name: string;
  readonly subject: string;
  readonly goal: string;
  readonly deadline: string;
  readonly language: string;
  readonly documentIds: readonly string[];
}

const DEFAULT_CREATE_COURSE_FORM: CreateCourseFormState = {
  name: "",
  subject: "",
  goal: "",
  deadline: "",
  language: "Tiếng Việt",
  documentIds: [],
};

export function CoursesPageContent({
  courses,
  documents,
}: {
  courses: readonly Course[];
  documents: readonly LearningDocument[];
}) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formState, setFormState] = useState<CreateCourseFormState>(DEFAULT_CREATE_COURSE_FORM);
  const { notify } = useToast();

  const readyDocuments = useMemo(
    () => documents.filter((document) => document.status === "ready"),
    [documents],
  );

  return (
    <div className="space-y-8">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">Sắp xếp việc học</Badge>
              <Badge tone="neutral">Dữ liệu minh họa</Badge>
          </div>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Gom tài liệu để ôn đúng trọng tâm</h2>
              <p className="max-w-3xl text-sm leading-6 text-ink-600 sm:text-base">
                Gom các tài liệu cùng mục tiêu vào một khóa học để dễ theo dõi tiến độ, chọn nội dung cần ôn và chuẩn bị cho kỳ thi.
              </p>
            </div>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              Tạo khóa học <PlusCircle className="h-4 w-4" />
            </Button>
          </div>
        </CardBody>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Khóa học" value={String(courses.length)} />
        <SummaryCard
          label="Tài liệu trong khóa học"
          value={String(courses.reduce((total, course) => total + course.documentIds.length, 0))}
        />
        <SummaryCard
          label="Ghi nhớ trung bình"
          value={
            courses.length > 0
              ? `${Math.round(courses.reduce((total, course) => total + course.masteryPct, 0) / courses.length)}%`
              : "—"
          }
        />
        <SummaryCard
          label="Lượt ôn đến hạn"
          value={String(courses.reduce((total, course) => total + course.dueReviews, 0))}
        />
      </section>

      <Card>
        <CardHeader>
          <SectionHeading
            eyebrow="Danh sách khóa học"
            title="Khóa học của bạn"
            description="Mỗi mục cho biết tài liệu, mức ghi nhớ, lượt ôn đến hạn và lần học gần nhất."
          />
        </CardHeader>
        <CardBody className="space-y-4">
          {courses.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {courses.map((course) => (
                <CourseCard key={course.id} course={course} documents={documents} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="Chưa có khóa học nào"
              description="Tạo khóa học đầu tiên để gom tài liệu và lên kế hoạch ôn theo môn học."
              action={<Button onClick={() => setIsCreateDialogOpen(true)}>Tạo khóa học</Button>}
            />
          )}
        </CardBody>
      </Card>

      <Dialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        title="Tạo khóa học"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleCreateCourse}>Lưu khóa học</Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            id="course-name"
            label="Tên khóa học"
            value={formState.name}
            onChange={(event) => updateForm("name", event.target.value)}
            placeholder="Ví dụ: Ôn thi cuối kỳ Hệ điều hành"
          />
          <TextField
            id="course-subject"
            label="Môn học"
            value={formState.subject}
            onChange={(event) => updateForm("subject", event.target.value)}
            placeholder="Ví dụ: Hệ điều hành"
          />
          <TextField
            id="course-goal"
            label="Mục tiêu hoặc kỳ thi"
            value={formState.goal}
            onChange={(event) => updateForm("goal", event.target.value)}
            placeholder="Ví dụ: Đạt A cuối kỳ"
          />
          <TextField
            id="course-deadline"
            label="Hạn học"
            type="date"
            value={formState.deadline}
            onChange={(event) => updateForm("deadline", event.target.value)}
          />
          <SelectField
            id="course-language"
            label="Ngôn ngữ"
            value={formState.language}
            onChange={(event) => updateForm("language", event.target.value)}
          >
            <option value="Tiếng Việt">Tiếng Việt</option>
            <option value="English">English</option>
            <option value="Song ngữ">Song ngữ</option>
          </SelectField>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink-700">Thêm tài liệu</legend>
            <div className="space-y-2 rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 p-3">
              {readyDocuments.map((document) => {
                const checked = formState.documentIds.includes(document.id);
                return (
                  <label key={document.id} className="flex items-start gap-3 rounded-xl px-1 py-1.5 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDocument(document.id)}
                      className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span>
                      <span className="font-medium text-ink-900">{document.title}</span>
                      <span className="mt-1 block text-xs text-ink-500">
                        Nội dung: {getOutputLabels(document.outputs)} · Ghi nhớ {document.masteryPct ?? 0}%
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Dialog>
    </div>
  );

  function updateForm<Key extends keyof CreateCourseFormState>(key: Key, value: CreateCourseFormState[Key]) {
    setFormState((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function toggleDocument(documentId: string) {
    setFormState((current) => {
      const hasDocument = current.documentIds.includes(documentId);
      const nextDocumentIds = hasDocument
        ? current.documentIds.filter((id) => id !== documentId)
        : [...current.documentIds, documentId];

      return {
        ...current,
        documentIds: nextDocumentIds,
      };
    });
  }

  function handleCreateCourse() {
    const fallbackName = formState.name.trim() || "Khóa học nháp";
    notify(`Đã tạo khóa học minh họa “${fallbackName}”.`, "success");
    setIsCreateDialogOpen(false);
    setFormState(DEFAULT_CREATE_COURSE_FORM);
  }
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
        <p className="text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
      </CardBody>
    </Card>
  );
}

function CourseCard({
  course,
  documents,
}: {
  course: Course;
  documents: readonly LearningDocument[];
}) {
  const linkedDocuments = documents.filter((document) => course.documentIds.includes(document.id));

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{course.subject}</Badge>
              <Badge tone="neutral">{course.language}</Badge>
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-ink-900">{course.name}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-600">{course.goal ?? "Chưa đặt mục tiêu học tập."}</p>
            </div>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <FileStack className="h-5 w-5" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Tài liệu" value={String(linkedDocuments.length)} />
          <MetricTile label="Lượt ôn đến hạn" value={String(course.dueReviews)} />
          <MetricTile
            label="Học gần nhất"
            value={course.lastStudiedAt ? formatDate(course.lastStudiedAt) : "Chưa học"}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-600">Mức ghi nhớ chung</span>
            <span className="font-medium text-ink-900">{course.masteryPct}%</span>
          </div>
          <ProgressBar value={course.masteryPct} tone="mastery" />
        </div>

        <div className="flex flex-wrap gap-3">
          <LinkButton href={routes.course(course.id)}>Mở khóa học</LinkButton>
          <LinkButton href={`${routes.tutor}?context=${encodeURIComponent(`course:${course.id}`)}`} variant="outline">
            Hỏi theo khóa học
          </LinkButton>
        </div>
      </CardBody>
    </Card>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-ink-900">{value}</p>
    </div>
  );
}
