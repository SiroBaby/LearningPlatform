import { notFound } from "next/navigation";
import { LearnerShell } from "@/components/layout";
import { WeakTopicDetail } from "@/components/analytics/weak-topic-detail";
import { weakTopics } from "@/lib/mock-data";

export function generateStaticParams() {
  return weakTopics.map((topic) => ({ id: topic.id }));
}

interface WeakTopicPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function WeakTopicPage({ params }: WeakTopicPageProps) {
  const { id } = await params;
  const weakTopic = weakTopics.find((topic) => topic.id === id);

  if (!weakTopic) {
    notFound();
  }

  return (
    <LearnerShell
      title={weakTopic.name}
      subtitle="Bằng chứng cụ thể từ attempt, citation và tài liệu liên quan để bạn biết chính xác nên sửa ở đâu trước khi luyện tiếp."
    >
      <WeakTopicDetail id={id} />
    </LearnerShell>
  );
}
