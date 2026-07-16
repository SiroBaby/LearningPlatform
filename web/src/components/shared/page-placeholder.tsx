import { Sparkles } from "lucide-react";
import { Card, CardBody, CardTitle, EmptyState } from "@/components/ui";

export function PagePlaceholder({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <Card>
      <CardBody className="space-y-6">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {bullets.map((bullet) => (
            <div key={bullet} className="rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-700">
              {bullet}
            </div>
          ))}
        </div>
        <EmptyState
          icon={Sparkles}
          title="Màn hình này sẽ được fan-out tiếp"
          description="Foundation đã sẵn sàng. Subagents sẽ triển khai chi tiết theo từng nhóm màn hình từ ui-requirements.md."
        />
      </CardBody>
    </Card>
  );
}
