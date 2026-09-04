export const VIETNAMESE_LOCALE = "vi-VN";
export const DEFAULT_DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

const vietnameseDateFormatter = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: DEFAULT_DISPLAY_TIME_ZONE,
});

const vietnameseMediumDateFormatter = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
  dateStyle: "medium",
  timeZone: DEFAULT_DISPLAY_TIME_ZONE,
});

const vietnameseShortDateTimeFormatter = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: DEFAULT_DISPLAY_TIME_ZONE,
});

const vietnameseDateTimeFormatter = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DEFAULT_DISPLAY_TIME_ZONE,
});

export function formatVietnameseDate(iso: string): string {
  return vietnameseDateFormatter.format(new Date(iso));
}

export function formatVietnameseMediumDate(iso: string): string {
  return vietnameseMediumDateFormatter.format(new Date(iso));
}

export function formatVietnameseShortDateTime(iso: string): string {
  return vietnameseShortDateTimeFormatter.format(new Date(iso));
}

export function formatVietnameseDateTime(iso: string): string {
  return vietnameseDateTimeFormatter.format(new Date(iso));
}
