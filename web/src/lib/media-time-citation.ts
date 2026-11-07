const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function toWholeSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

/** Format seconds as m:ss, or h:mm:ss from one hour. Rounds down, never negative. */
export function formatMediaTime(totalSec: number): string {
  const seconds = toWholeSeconds(totalSec);
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = String(seconds % SECONDS_PER_MINUTE).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
  }
  return `${minutes}:${rest}`;
}

/** "Từ m:ss đến m:ss", or "Tại m:ss" when the end is missing or not after the start. */
export function formatTimeCitationLabel(startSec: number, endSec?: number | null): string {
  const start = toWholeSeconds(startSec);
  const end = typeof endSec === "number" ? toWholeSeconds(endSec) : start;
  if (end <= start) {
    return `Tại ${formatMediaTime(start)}`;
  }
  return `Từ ${formatMediaTime(start)} đến ${formatMediaTime(end)}`;
}
