"use client";

import { AlertTriangle } from "lucide-react";
import { LearnerShell } from "@/components/layout/learner-shell";
import { Button, Card, CardBody, LinkButton } from "@/components/ui";

interface LearnerRouteErrorProps {
  readonly title: string;
  readonly description: string;
  readonly backHref: string;
  readonly backLabel: string;
  readonly reset: () => void;
}

export function LearnerRouteError({
  title,
  description,
  backHref,
  backLabel,
  reset,
}: LearnerRouteErrorProps) {
  return (
    <LearnerShell title={title} subtitle="Bạn vẫn có thể quay lại luồng học tập để tiếp tục.">
      <Card role="alert" className="border-error-100 bg-error-50/70">
        <CardBody className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-error-100 text-error-700">
            <AlertTriangle className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-700">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={reset}>Thử lại</Button>
            <LinkButton href={backHref} variant="outline">{backLabel}</LinkButton>
          </div>
        </CardBody>
      </Card>
    </LearnerShell>
  );
}
