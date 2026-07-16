"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CircleCheck, FileStack, Target, Video } from "lucide-react";
import { courses, documents, exams, formatDate } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, LinkButton, ProgressBar, SelectField, TextField, useToast } from "@/components/ui";

interface QuestionTypeOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

const questionTypeOptions: readonly QuestionTypeOption[] = [
  {
    id: "mixed",
    label: "Mixed recall",
    description: "Trộn câu hỏi nhận biết, giải thích cơ chế và tình huống ngắn.",
  },
  {
    id: "conceptual",
    label: "Conceptual focus",
    description: "Ưu tiên câu hỏi kiểm tra hiểu bản chất và so sánh khái niệm.",
  },
  {
    id: "timed",
    label: "Timed exam style",
    description: "Mô phỏng áp lực phòng thi, feedback chỉ xuất hiện sau khi nộp bài.",
  },
] as const;

function getInitialExam() {
  return exams[0];
}

function getCourseDocumentIds(courseId: string): readonly string[] {
  return courses.find((course) => course.id === courseId)?.documentIds ?? [];
}

function getRecommendedMinutes(documentCount: number): number {
  return Math.max(25, documentCount * 12);
}

export function ExamSetupScreen() {
  const { notify } = useToast();
  const initialExam = getInitialExam();
  const [examName, setExamName] = useState(initialExam.name);
  const [selectedCourseId, setSelectedCourseId] = useState(initialExam.courseId ?? courses[0]?.id ?? "");
  const [examDate, setExamDate] = useState(initialExam.date);
  const [targetScore, setTargetScore] = useState(String(initialExam.targetScorePct));
  const [questionType, setQuestionType] = useState<QuestionTypeOption["id"]>("mixed");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([...initialExam.documentIds]);

  const availableDocuments = useMemo(
    () => documents.filter((documentItem) => getCourseDocumentIds(selectedCourseId).includes(documentItem.id)),
    [selectedCourseId],
  );

  const estimatedMinutes = getRecommendedMinutes(selectedDocumentIds.length);

  function toggleDocument(documentId: string): void {
    setSelectedDocumentIds((currentIds) => {
      if (currentIds.includes(documentId)) {
        return currentIds.filter((id) => id !== documentId);
      }

      return [...currentIds, documentId];
    });
  }

  function saveSetup(): void {
    notify("Đã lưu mock exam setup. Bạn có thể mở practice exam để xem luồng thi thử.", "success");
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Exam configuration</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Chọn course, deadline, tài liệu và kiểu câu hỏi để hệ thống sắp lịch ôn cũng như build practice exam phù hợp.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                id="exam-name"
                label="Exam name"
                value={examName}
                onChange={(event) => setExamName(event.target.value)}
              />
              <TextField
                id="exam-date"
                label="Exam date"
                type="date"
                value={examDate}
                onChange={(event) => setExamDate(event.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                id="course"
                label="Subject / course"
                value={selectedCourseId}
                onChange={(event) => {
                  const nextCourseId = event.target.value;
                  setSelectedCourseId(nextCourseId);
                  setSelectedDocumentIds([...getCourseDocumentIds(nextCourseId)]);
                }}
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                id="target-score"
                label="Target score (%)"
                type="number"
                min={50}
                max={100}
                value={targetScore}
                onChange={(event) => setTargetScore(event.target.value)}
                hint="Dùng để điều chỉnh readiness target và cường độ study plan."
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-ink-700">Question type preference</p>
              <div className="grid gap-3">
                {questionTypeOptions.map((option) => {
                  const isSelected = questionType === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setQuestionType(option.id)}
                      className={`rounded-2xl border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-brand-200 bg-brand-50"
                          : "border-ink-100 hover:border-brand-200 hover:bg-brand-50/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink-900">{option.label}</p>
                          <p className="mt-1 text-sm leading-6 text-ink-600">{option.description}</p>
                        </div>
                        {isSelected ? <Badge tone="brand">Selected</Badge> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-ink-700">Documents included</p>
              <div className="grid gap-3">
                {availableDocuments.map((documentItem) => {
                  const isSelected = selectedDocumentIds.includes(documentItem.id);
                  return (
                    <label
                      key={documentItem.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                        isSelected
                          ? "border-brand-200 bg-brand-50"
                          : "border-ink-100 hover:border-brand-200 hover:bg-brand-50/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                        checked={isSelected}
                        onChange={() => toggleDocument(documentItem.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-ink-900">{documentItem.title}</p>
                          <Badge tone={documentItem.status === "ready" ? "success" : documentItem.status === "processing" ? "brand" : "warning"}>
                            {documentItem.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-ink-500">
                          {documentItem.outputs.join(" · ") || "Chưa có output"}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={saveSetup}>Save setup</Button>
              <LinkButton href={routes.practiceExam(initialExam.id)} variant="outline">
                Open practice exam
              </LinkButton>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Readiness preview</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Preview này giúp người học hiểu setup sẽ ảnh hưởng thế nào đến độ phủ và nhịp ôn tập.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="rounded-2xl border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{examName}</p>
                  <p className="mt-1 text-sm text-ink-500">Exam day {formatDate(examDate)}</p>
                </div>
                <Badge tone="brand">{targetScore}% target</Badge>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-sm text-ink-600">
                  <span>Current readiness</span>
                  <span className="font-medium text-ink-900">{initialExam.readinessPct}%</span>
                </div>
                <ProgressBar value={initialExam.readinessPct} tone="brand" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <FileStack className="h-4 w-4 text-brand-600" />
                  Coverage
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{selectedDocumentIds.length}</p>
                <p className="mt-1 text-sm text-ink-500">documents included</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <CalendarClock className="h-4 w-4 text-review-600" />
                  Study load
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{estimatedMinutes} phút</p>
                <p className="mt-1 text-sm text-ink-500">khuyến nghị cho mỗi phiên ôn</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Target className="h-4 w-4 text-mastery-600" />
                  Weak topics
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">3</p>
                <p className="mt-1 text-sm text-ink-500">cần được kéo lên trước mock exam cuối</p>
              </div>
              <div className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Video className="h-4 w-4 text-warning-700" />
                  Media mix
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink-900">{availableDocuments.filter((documentItem) => documentItem.type === "video").length}</p>
                <p className="mt-1 text-sm text-ink-500">video lectures with checkpoints</p>
              </div>
            </div>

            <div className="rounded-2xl border border-success-100 bg-success-50 p-4">
              <div className="flex items-start gap-3">
                <CircleCheck className="mt-0.5 h-5 w-5 text-success-700" />
                <div>
                  <p className="text-sm font-semibold text-success-800">Recommended schedule</p>
                  <p className="mt-1 text-sm leading-6 text-success-800/90">
                    3 ngày đầu tập trung review weak topics có citation. 2 ngày tiếp theo chuyển dần sang practice exam timed mode. Ngày cuối giữ phiên ngắn để tránh quá tải.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
              Mock setup này không ghi dữ liệu thật. Mục tiêu của UI là giúp learner hiểu rõ course nào, tài liệu nào và kiểu câu hỏi nào sẽ đi vào luồng thi thử trước khi bắt đầu.
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
