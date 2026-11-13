/** Paging for the subtitle preview table: a long subtitle is shown 100 rows at a time. */

export const SUBTITLE_PREVIEW_PAGE_SIZE = 100;

export interface SubtitlePreviewPage<T> {
  readonly rows: readonly T[];
  readonly pageIndex: number;
  readonly pageCount: number;
  /** 1-based number of the first row on this page; 0 when there are no rows. */
  readonly firstRowNumber: number;
}

/** Clamps an out-of-range page index so a stale index never shows an empty table. */
export function getSubtitlePreviewPage<T>(
  rows: readonly T[],
  requestedPageIndex: number,
  pageSize: number = SUBTITLE_PREVIEW_PAGE_SIZE,
): SubtitlePreviewPage<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageIndex = Math.min(Math.max(0, Math.trunc(requestedPageIndex) || 0), pageCount - 1);
  const start = pageIndex * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pageIndex,
    pageCount,
    firstRowNumber: rows.length === 0 ? 0 : start + 1,
  };
}
