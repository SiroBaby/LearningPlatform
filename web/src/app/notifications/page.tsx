import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { LearnerShell } from "@/components/layout";
import { Card, CardBody, CardHeader, CardTitle, Badge, LinkButton } from "@/components/ui";
import { formatDateTime, notifications } from "@/lib/mock-data";

export const metadata: Metadata = {
  title: "Notifications",
  description:
    "Theo dõi document ready, processing failed, review due, low credits và các tín hiệu quan trọng khác trong quá trình học.",
};

export default function NotificationsPage() {
  return (
    <LearnerShell
      title="Notifications"
      subtitle="Thông báo phải dẫn người học quay lại đúng route cần hành động thay vì chỉ báo trạng thái chung chung."
    >
      <Card>
        <CardHeader>
          <CardTitle>Notification center</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {notifications.map((item) => (
            <div key={item.id} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                    <BellRing className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!item.read ? <Badge tone="brand">Unread</Badge> : <Badge>Read</Badge>}
                      <span className="text-xs text-ink-400">{formatDateTime(item.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-ink-900">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-ink-600">{item.body}</p>
                  </div>
                </div>
                {item.href ? <LinkButton href={item.href} size="sm" variant="outline">Open</LinkButton> : null}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </LearnerShell>
  );
}
