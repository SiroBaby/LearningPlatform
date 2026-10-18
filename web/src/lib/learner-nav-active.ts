const HOME_PATH = "/home";

/**
 * /flashcards/*, /study-plan và /exam/* không có mục riêng trong menu;
 * đây đều là hoạt động ôn luyện nên được tính vào mục "Ôn tập".
 */
const REVIEW_PATH = "/review";
const REVIEW_AREA_PATHS: readonly string[] = ["/flashcards", "/study-plan", "/exam"];

const ALIAS_PATHS_BY_HREF: Readonly<Record<string, readonly string[]>> = {
  [REVIEW_PATH]: REVIEW_AREA_PATHS,
};

/** Các mục nằm trong menu "Thêm" trên điện thoại (khớp `learnerMobileMoreNav`). */
export const MOBILE_MORE_HREFS: readonly string[] = ["/analytics", "/courses", "/billing", "/settings"];

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || (path !== HOME_PATH && pathname.startsWith(`${path}/`));
}

/** Cho biết mục điều hướng người học có đang được chọn ở `pathname` hay không. */
export function isLearnerRouteActive(pathname: string, href: string): boolean {
  if (matchesPath(pathname, href)) return true;
  return (ALIAS_PATHS_BY_HREF[href] ?? []).some((path) => matchesPath(pathname, path));
}

/** Cho biết nút "Thêm" trên điện thoại có nên sáng ở `pathname` hay không. */
export function isMobileMoreActive(pathname: string): boolean {
  return MOBILE_MORE_HREFS.some((href) => isLearnerRouteActive(pathname, href));
}
