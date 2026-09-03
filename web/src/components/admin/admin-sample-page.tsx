import type { LucideIcon } from "lucide-react";

import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

export interface AdminSampleMetric {
  readonly label: string;
  readonly value: string;
  readonly helper: string;
}

export interface AdminSampleItem {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
}

export function AdminSamplePage({
  icon: Icon,
  title,
  subtitle,
  metrics,
  itemsTitle,
  itemsDescription,
  items,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: string;
  readonly metrics: readonly AdminSampleMetric[];
  readonly itemsTitle: string;
  readonly itemsDescription: string;
  readonly items: readonly AdminSampleItem[];
}): React.ReactNode {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-review-50/70 p-6 sm:p-8">
        <div className="flex max-w-3xl items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-sm">
            <Icon className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <Badge tone="brand">Dữ liệu minh họa</Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h2>
            <p className="mt-3 text-base leading-7 text-ink-600">{subtitle}</p>
          </div>
        </div>
      </section>

      <section aria-label={title} className="grid gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardBody>
              <p className="text-sm font-semibold text-brand-700">{metric.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">{metric.value}</p>
              <p className="mt-1 text-sm leading-5 text-ink-600">{metric.helper}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{itemsTitle}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-ink-600">{itemsDescription}</p>
        </CardHeader>
        <CardBody>
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.title} className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-ink-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                  <p className="mt-1 text-sm leading-5 text-ink-600">{item.detail}</p>
                </div>
                <Badge tone="neutral">{item.status}</Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
