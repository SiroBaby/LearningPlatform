"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bot, BookOpenCheck, FileStack, MessageSquareQuote, SearchCheck, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { citations, courses, documents, weakTopics } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import type { Citation, TutorMessage } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CitationBadge,
  CitationSnippet,
  EmptyState,
  LinkButton,
  SectionHeading,
} from "@/components/ui";

interface TutorContextOption {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly documentIds: readonly string[];
  readonly href: string;
}

interface TutorAnswerTemplate {
  readonly key: string;
  readonly matcher: (question: string) => boolean;
  readonly content: string;
  readonly citations: readonly Citation[];
}

const TUTOR_SUGGESTED_PROMPTS = [
  "Explain this like I’m 10.",
  "Quiz me on this chapter.",
  "What are the key formulas?",
  "What should I review before the exam?",
  "Compare these two concepts.",
  "Make 5 flashcards from this section.",
] as const;

const TUTOR_ANSWER_TEMPLATES: readonly TutorAnswerTemplate[] = [
  {
    key: "os-simple",
    matcher: (question) => hasKeyword(question, ["explain", "10", "child", "đơn giản", "context switch", "tiến trình"]),
    content:
      "Hãy hình dung CPU như một giáo viên chỉ có thể nói chuyện với một học sinh tại một thời điểm. Khi giáo viên đổi từ học sinh A sang học sinh B, thầy phải dừng lại, ghi nhớ A đang làm đến đâu, rồi mở lại ghi chú của B. Chính việc ghi nhớ và mở lại này tạo ra context-switch overhead.",
    citations: [citations.osContextSwitch],
  },
  {
    key: "tcp-udp",
    matcher: (question) => hasKeyword(question, ["tcp", "udp", "compare", "khác nhau", "network"]),
    content:
      "TCP ưu tiên độ tin cậy: nó bắt tay ba bước trước khi truyền dữ liệu. UDP thì bỏ qua bước thiết lập kết nối để giảm độ trễ, đổi lại không đảm bảo thứ tự hay độ tin cậy. Nếu bạn đang ôn thi, phần cần nhớ là trade-off giữa reliability và latency.",
    citations: [citations.videoTcp, citations.videoUdp],
  },
  {
    key: "gradient",
    matcher: (question) => hasKeyword(question, ["formula", "gradient", "learning rate", "optimization"]),
    content:
      "Trong bộ tài liệu hiện tại, điểm trọng tâm là quy tắc cập nhật của gradient descent: tham số được điều chỉnh theo hướng ngược lại gradient của hàm loss, với bước nhảy do learning rate quyết định. Nếu bạn muốn, tôi có thể biến quy tắc này thành flashcards hoặc mini quiz ngay trong context hiện tại.",
    citations: [citations.mlGradient],
  },
  {
    key: "review-plan",
    matcher: (question) => hasKeyword(question, ["review", "exam", "weak", "ôn", "chuẩn bị thi"]),
    content:
      "Trước kỳ thi, bạn nên ưu tiên hai cụm yếu đang hiện rõ trong mock data: Đồng bộ tiến trình và UDP vs TCP. Cả hai đều đã có câu sai hoặc checkpoint bỏ lỡ, nên chiến lược tốt nhất là review lại citation gốc trước, sau đó làm flashcard review rồi mới chuyển sang quiz retry.",
    citations: [citations.osSync, citations.videoUdp],
  },
  {
    key: "flashcards",
    matcher: (question) => hasKeyword(question, ["flashcard", "5 cards", "thẻ", "make cards"]),
    content:
      "Tôi có thể rút ngay 5 flashcard theo phần đang học: context switch overhead, Round-Robin quantum, wait()/signal() trên semaphore, three-way handshake của TCP, và trade-off của UDP. Mỗi thẻ đều nên gắn citation để bạn quay lại đúng đoạn gốc khi cần kiểm tra lại.",
    citations: [citations.osContextSwitch, citations.osScheduling, citations.osSync, citations.videoTcp, citations.videoUdp],
  },
] as const;

export function TutorPageContent({
  selectedContextKey,
}: {
  selectedContextKey?: string;
}) {
  const contextOptions = useMemo(() => buildTutorContextOptions(), []);
  const selectedContext =
    contextOptions.find((option) => option.key === selectedContextKey) ?? contextOptions[0];
  const [composerValue, setComposerValue] = useState("");
  const [messages, setMessages] = useState<TutorMessage[]>([buildGreetingMessage(selectedContext)]);

  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  const visibleCitations = latestAssistantMessage?.citations ?? [];
  const visibleContextDocuments = documents.filter((document) => selectedContext.documentIds.includes(document.id));

  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <SectionHeading
                eyebrow="Context selector"
                title="Chọn phạm vi bằng chứng trước khi hỏi"
                description="Context được giữ trên URL để refresh hoặc share mà vẫn còn đúng course / document bạn đang học."
              />
            </CardHeader>
            <CardBody className="space-y-3">
              {contextOptions.map((option) => (
                <Link
                  key={option.key}
                  href={option.href}
                  className={cn(
                    "block rounded-[var(--radius-card)] border p-4 transition-colors",
                    option.key === selectedContext.key
                      ? "border-brand-200 bg-brand-50 text-brand-700"
                      : "border-ink-200 bg-ink-50/60 text-ink-700 hover:bg-ink-50",
                  )}
                  aria-current={option.key === selectedContext.key ? "page" : undefined}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={option.key === selectedContext.key ? "brand" : "neutral"}>
                      {option.key === selectedContext.key ? "Active context" : "Available context"}
                    </Badge>
                    <span className="text-sm font-semibold">{option.label}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-600">{option.description}</p>
                </Link>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeading
                eyebrow="Tutor chat"
                title="Hỏi tự do, nhưng luôn nhìn thấy nguồn"
                description="Assistant chỉ nên trả lời khi tìm thấy bằng chứng trong context đã chọn. Nếu không đủ bằng chứng, nó phải nói rõ điều đó."
              />
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {TUTOR_SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => submitPrompt(prompt)}
                    className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                className="space-y-4 rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/50 p-4"
              >
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!composerValue.trim()) {
                    return;
                  }
                  submitPrompt(composerValue);
                }}
              >
                <label className="block text-sm font-medium text-ink-700" htmlFor="tutor-question">
                  Ask tutor
                </label>
                <textarea
                  id="tutor-question"
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  className="min-h-28 w-full rounded-[var(--radius-card)] border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  placeholder="Ví dụ: So sánh TCP và UDP theo kiểu dễ nhớ trước kỳ thi."
                />
                <div className="flex flex-wrap gap-3">
                  <Button type="submit">
                    Send question <Send className="h-4 w-4" />
                  </Button>
                  <LinkButton href={routes.review} variant="outline">
                    Open review queue
                  </LinkButton>
                </div>
              </form>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
                <SearchCheck className="h-4 w-4 text-brand-600" />
                <span>Visible evidence</span>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              {latestAssistantMessage?.noEvidence ? (
                <EmptyState
                  icon={SearchCheck}
                  title="Chưa có đủ bằng chứng trong nguồn"
                  description="Tutor đang nói rõ rằng nó không tìm thấy source evidence đủ mạnh trong context hiện tại. Hãy đổi context hoặc hỏi hẹp hơn."
                  action={<LinkButton href={buildTutorHref("all")}>Switch to all documents</LinkButton>}
                />
              ) : visibleCitations.length > 0 ? (
                visibleCitations.map((citation) => <CitationSnippet key={citation.chunkId} citation={citation} />)
              ) : (
                <EmptyState
                  icon={MessageSquareQuote}
                  title="Chưa có answer card nào"
                  description="Chọn prompt gợi ý hoặc gửi câu hỏi để làm đầy panel citation này."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
                <FileStack className="h-4 w-4 text-brand-600" />
                <span>Documents in context</span>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {visibleContextDocuments.map((document) => (
                <div key={document.id} className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
                  <p className="text-sm font-semibold text-ink-900">{document.title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink-600">
                    Outputs: {document.outputs.join(", ")} · Mastery {document.masteryPct ?? 0}%
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
                <BookOpenCheck className="h-4 w-4 text-brand-600" />
                <span>Weak topics you can ask about</span>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {weakTopics
                .filter((topic) => topic.citations.some((citation) => selectedContext.documentIds.includes(citation.documentId)))
                .map((topic) => (
                  <div key={topic.id} className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink-900">{topic.name}</p>
                      <Badge tone="review">Mastery {topic.masteryPct}%</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink-600">
                      Missed questions: {topic.missedQuestions}. Hãy dùng Tutor để giải thích lại, rồi chuyển sang flashcards hoặc quiz retry.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {topic.citations.map((citation) => (
                        <CitationBadge key={citation.chunkId} citation={citation} />
                      ))}
                    </div>
                  </div>
                ))}
            </CardBody>
          </Card>
        </div>
      </section>
    </div>
  );

  function submitPrompt(prompt: string) {
    const userMessage: TutorMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
    };
    const assistantMessage = buildAssistantMessage(prompt, selectedContext);

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setComposerValue("");
  }
}

function MessageBubble({ message }: { message: TutorMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border p-4",
        isAssistant ? "border-brand-100 bg-white" : "border-ink-200 bg-ink-100/70",
        message.noEvidence && "border-warning-200 bg-warning-50",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl",
            isAssistant ? "bg-brand-50 text-brand-600" : "bg-ink-200 text-ink-700",
            message.noEvidence && "bg-warning-100 text-warning-700",
          )}
        >
          {isAssistant ? <Bot className="h-4 w-4" /> : <MessageSquareQuote className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">{isAssistant ? "Tutor" : "You"}</p>
            <p className="mt-1 text-sm leading-6 text-ink-700">{message.content}</p>
          </div>
          {isAssistant && message.citations?.length ? (
            <div className="flex flex-wrap gap-2">
              {message.citations.map((citation) => (
                <CitationBadge key={citation.chunkId} citation={citation} />
              ))}
            </div>
          ) : null}
          {isAssistant && message.noEvidence ? (
            <p className="text-sm font-medium text-warning-700">
              We could not find enough source evidence to answer confidently.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function buildGreetingMessage(selectedContext: TutorContextOption): TutorMessage {
  return {
    id: `assistant-greeting-${selectedContext.key}`,
    role: "assistant",
    content: `Tutor đang đọc context “${selectedContext.label}”. Hỏi tôi để giải thích, quiz lại, hoặc nhờ gom flashcards — tôi sẽ chỉ bám vào tài liệu nằm trong phạm vi này.`,
  };
}

function buildAssistantMessage(question: string, selectedContext: TutorContextOption): TutorMessage {
  const matchedTemplate = TUTOR_ANSWER_TEMPLATES.find((template) => template.matcher(question));

  if (!matchedTemplate) {
    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "Tôi chưa tìm thấy chunk nguồn đủ sát để trả lời câu này trong context hiện tại. Hãy hỏi hẹp hơn theo topic, document, hoặc đổi sang context rộng hơn.",
      noEvidence: true,
    };
  }

  const contextualCitations = matchedTemplate.citations.filter((citation) =>
    selectedContext.documentIds.includes(citation.documentId),
  );

  if (contextualCitations.length === 0) {
    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "Tôi thấy câu hỏi hợp lý, nhưng không có đủ bằng chứng trong context bạn đang chọn. Hãy chuyển context sang course hoặc all documents rồi hỏi lại để tôi bám đúng nguồn.",
      noEvidence: true,
    };
  }

  return {
    id: `assistant-${Date.now()}`,
    role: "assistant",
    content: matchedTemplate.content,
    citations: contextualCitations,
  };
}

function buildTutorContextOptions(): TutorContextOption[] {
  const allDocumentsContext: TutorContextOption = {
    key: "all",
    label: "All documents",
    description: "Tutor có thể tham chiếu qua toàn bộ tài liệu mock đang sẵn sàng.",
    documentIds: documents.filter((document) => document.status === "ready").map((document) => document.id),
    href: buildTutorHref("all"),
  };

  const courseContexts = courses.map((course) => ({
    key: `course:${course.id}`,
    label: course.name,
    description: `${course.documentIds.length} documents · Due reviews ${course.dueReviews}`,
    documentIds: course.documentIds,
    href: buildTutorHref(`course:${course.id}`),
  }));

  const documentContexts = documents
    .filter((document) => document.status === "ready")
    .map((document) => ({
      key: `document:${document.id}`,
      label: document.title,
      description: `Single-document grounding · Outputs: ${document.outputs.join(", ")}`,
      documentIds: [document.id],
      href: buildTutorHref(`document:${document.id}`),
    }));

  return [allDocumentsContext, ...courseContexts, ...documentContexts];
}

function buildTutorHref(contextKey: string): string {
  return contextKey === "all" ? routes.tutor : `${routes.tutor}?context=${encodeURIComponent(contextKey)}`;
}

function hasKeyword(question: string, keywords: readonly string[]): boolean {
  const normalizedQuestion = question.toLowerCase();
  return keywords.some((keyword) => normalizedQuestion.includes(keyword));
}
