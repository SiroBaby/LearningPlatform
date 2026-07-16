"use client";

import { FileText, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatSec } from "@/lib/mock-data";
import type { Citation, Locator } from "@/lib/types";

export function locatorLabel(locator: Locator): string {
  switch (locator.kind) {
    case "page":
      return `Trang ${locator.page}`;
    case "text-range":
      return `Ký tự ${locator.start}-${locator.end}`;
    case "time":
      return `${formatSec(locator.startSec)}–${formatSec(locator.endSec)}`;
  }
}

/** Compact citation badge — clickable, keyboard reachable. */
export function CitationBadge({
  citation,
  onJumpAction,
  className,
}: {
  citation: Citation;
  onJumpAction?: (citation: Citation) => void;
  className?: string;
}) {
  const Icon = citation.locator.kind === "time" ? Clock : FileText;
  const label = locatorLabel(citation.locator);
  return (
    <button
      type="button"
      onClick={() => onJumpAction?.(citation)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-brand-100 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>Nguồn · {label}</span>
      {onJumpAction && <ExternalLink className="h-3 w-3" aria-hidden />}
    </button>
  );
}

/** Full source snippet panel — builds trust by showing the grounding. */
export function CitationSnippet({
  citation,
  onJumpAction,
}: {
  citation: Citation;
  onJumpAction?: (citation: Citation) => void;
}) {
  const label = locatorLabel(citation.locator);
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-brand-700">
          Trích dẫn nguồn · {label}
        </span>
        {onJumpAction && (
          <button
            type="button"
            onClick={() => onJumpAction(citation)}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
          >
            Xem nguồn <ExternalLink className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
      <p className="text-sm leading-relaxed text-ink-700 italic">
        “{citation.snippet}”
      </p>
      <p className="mt-1.5 text-xs text-ink-500">{citation.documentTitle}</p>
    </div>
  );
}
