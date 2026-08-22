"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileStack, Send } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ProgressBar,
  SelectField,
  TextArea,
  TextField,
  useToast,
} from "@/components/ui";
import { assignments, classrooms, documents } from "@/lib/mock-data";
import type { Assignment, Classroom, LearningDocument } from "@/lib/types";

const DEFAULT_CLASS_ID = classrooms[0]?.id ?? "";
const DEFAULT_DOCUMENT_ID = documents.find((document) => document.status === "ready")?.id ?? "";

interface AssignmentFormState {
  classId: string;
  documentId: string;
  activityType: "quiz" | "checkpoints";
  title: string;
  dueDate: string;
  attemptRule: "one" | "two" | "unlimited";
  instructions: string;
  publishNow: boolean;
}

function buildDefaultState(): AssignmentFormState {
  return {
    classId: DEFAULT_CLASS_ID,
    documentId: DEFAULT_DOCUMENT_ID,
    activityType: "quiz",
    title: "Quiz Chương 3 — Quản lý tiến trình",
    dueDate: "2026-07-15",
    attemptRule: "two",
    instructions:
      "Yêu cầu học sinh xem lại phần citation sau mỗi câu sai trước khi thử lại. Ưu tiên làm trong 12 phút.",
    publishNow: true,
  };
}

function getSelectedClassroom(classId: string): Classroom | undefined {
  return classrooms.find((classroom) => classroom.id === classId);
}

function getSelectedDocument(documentId: string): LearningDocument | undefined {
  return documents.find((document) => document.id === documentId);
}

function getExistingAssignments(classId: string): Assignment[] {
  return assignments.filter((assignment) => assignment.classId === classId);
}

function getAttemptRuleLabel(attemptRule: AssignmentFormState["attemptRule"]): string {
  if (attemptRule === "one") return "1 lần";
  if (attemptRule === "two") return "2 lần";
  return "Không giới hạn";
}

export function TeacherAssignmentForm() {
  const { notify } = useToast();
  const [formState, setFormState] = useState<AssignmentFormState>(buildDefaultState);

  const selectedClassroom = useMemo(
    () => getSelectedClassroom(formState.classId),
    [formState.classId],
  );
  const selectedDocument = useMemo(
    () => getSelectedDocument(formState.documentId),
    [formState.documentId],
  );
  const existingAssignments = useMemo(
    () => getExistingAssignments(formState.classId),
    [formState.classId],
  );

  const coveragePct = selectedClassroom
    ? Math.min(
        100,
        Math.round(
          ((existingAssignments.length + 1) /
            Math.max(1, selectedClassroom.documentIds.length + 1)) *
            100,
        ),
      )
    : 0;

  function updateField<Key extends keyof AssignmentFormState>(
    key: Key,
    value: AssignmentFormState[Key],
  ): void {
    setFormState((currentState) => ({
      ...currentState,
      [key]: value,
    }));
  }

  function handleSaveDraft(): void {
    notify("Đã lưu mock draft assignment. Chưa có backend nên thay đổi không được persist.");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const message = formState.publishNow
      ? "Đã mock publish assignment cho lớp. Hãy verify lại copy, due date và attempt rule."
      : "Đã mock lưu assignment để review nội bộ trước khi publish.";
    notify(message, "success");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="border-ink-100">
        <CardHeader>
          <CardTitle>Tạo assignment mới</CardTitle>
          <p className="mt-1 text-sm text-ink-600">
            Chọn lớp, document và output đã generate sẵn. Surface này mock-only, phù hợp để chốt luồng giáo viên trước khi nối backend.
          </p>
        </CardHeader>
        <CardBody>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                id="classId"
                label="Class"
                value={formState.classId}
                onChange={(event) => updateField("classId", event.target.value)}
              >
                {classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="documentId"
                label="Document"
                value={formState.documentId}
                onChange={(event) => updateField("documentId", event.target.value)}
              >
                {documents
                  .filter((document) => document.status === "ready")
                  .map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
              </SelectField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                id="activityType"
                label="Generated activity"
                value={formState.activityType}
                onChange={(event) =>
                  updateField(
                    "activityType",
                    event.target.value as AssignmentFormState["activityType"],
                  )
                }
              >
                <option value="quiz">Quiz</option>
                <option value="checkpoints">Video checkpoints</option>
              </SelectField>
              <SelectField
                id="attemptRule"
                label="Attempt rule"
                value={formState.attemptRule}
                onChange={(event) =>
                  updateField(
                    "attemptRule",
                    event.target.value as AssignmentFormState["attemptRule"],
                  )
                }
              >
                <option value="one">1 lần</option>
                <option value="two">2 lần</option>
                <option value="unlimited">Không giới hạn</option>
              </SelectField>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <TextField
                id="title"
                label="Assignment title"
                value={formState.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="Ví dụ: Quiz Chương 3 — Quản lý tiến trình"
                required
              />
              <TextField
                id="dueDate"
                label="Due date"
                type="date"
                value={formState.dueDate}
                onChange={(event) => updateField("dueDate", event.target.value)}
                required
              />
            </div>

            <TextArea
              id="instructions"
              label="Teacher instructions"
              value={formState.instructions}
              onChange={(event) => updateField("instructions", event.target.value)}
              hint="Hiện thành note ở student-facing assignment card hoặc email reminder sau này."
            />

            <label className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-4 text-sm text-ink-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600"
                checked={formState.publishNow}
                onChange={(event) => updateField("publishNow", event.target.checked)}
              />
              <span>
                Publish ngay sau khi lưu. Nếu tắt, assignment sẽ ở trạng thái draft để review thêm.
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button type="submit">
                <Send className="h-4 w-4" aria-hidden />
                {formState.publishNow ? "Publish mock assignment" : "Lưu mock draft"}
              </Button>
              <Button type="button" variant="outline" onClick={handleSaveDraft}>
                Lưu draft cục bộ
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card className="border-ink-100 bg-ink-50/70">
        <CardHeader>
          <CardTitle>Preview trước khi publish</CardTitle>
          <p className="mt-1 text-sm text-ink-600">
            Tóm tắt ngắn để giáo viên kiểm tra độ phù hợp của assignment trước khi đẩy cho lớp.
          </p>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge tone="brand">{formState.activityType}</Badge>
              <Badge tone="neutral">{getAttemptRuleLabel(formState.attemptRule)}</Badge>
              <Badge tone={formState.publishNow ? "success" : "warning"}>
                {formState.publishNow ? "Publish now" : "Draft only"}
              </Badge>
            </div>
            <p className="text-lg font-semibold text-ink-900">{formState.title}</p>
            <p className="text-sm text-ink-600">
              {selectedClassroom?.name ?? "Chưa chọn lớp"}
            </p>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white px-4 py-4">
            <div className="flex items-start gap-3">
              <FileStack className="mt-0.5 h-4 w-4 text-brand-600" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink-800">Nguồn dùng để giao bài</p>
                <p className="mt-1 text-sm leading-6 text-ink-600">
                  {selectedDocument?.title ?? "Chưa chọn document"}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white px-4 py-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-500">Coverage trong lớp</span>
              <span className="font-medium text-ink-800">{coveragePct}%</span>
            </div>
            <ProgressBar value={coveragePct} tone="brand" />
            <p className="mt-3 text-sm text-ink-600">
              Lớp này hiện có {existingAssignments.length} assignment. Assignment mới sẽ phủ thêm một hoạt động học chủ động cho lớp.
            </p>
          </div>

          <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-4 text-sm text-success-800">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Học sinh sẽ thấy due date, attempt rule và note của giáo viên ngay trong assignment card. Vì đây là mock-only, bạn nên verify thêm copy và trạng thái published/draft với main agent.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
