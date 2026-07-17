import { Badge } from "@/components/ui";

export function UploadSpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/90 p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-ink-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

export function UploadSpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-ink-600">{label}</dt>
      <dd className="max-w-[60%] break-words text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

export function UploadSelectionBadges() {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone="neutral">PDF</Badge>
      <Badge tone="neutral">TXT</Badge>
    </div>
  );
}
