export const VIETNAMESE_LOCALE = "vi-VN";
export const DEFAULT_DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

const vietnameseDateTimeFormatter = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DEFAULT_DISPLAY_TIME_ZONE,
});

export function formatVietnameseDateTime(iso: string): string {
  return vietnameseDateTimeFormatter.format(new Date(iso));
}
