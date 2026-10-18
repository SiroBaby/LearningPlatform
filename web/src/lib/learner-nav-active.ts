const HOME_PATH = "/home";

/** Các khu vực học tập không có mục riêng trong menu, được tính vào mục "Ôn tập". */
const REVIEW_PATH = "/review";
const REVIEW_AREA_PATHS: readonly string[] = ["/flashcards", "/study-plan", "/exam"];

const ALIAS_PATHS_BY_HREF: Readonly<Record<string, readonly string[]>> = {
  [REVIEW_PATH]: REVIEW_AREA_PATHS,
};

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || (path !== HOME_PATH && pathname.startsWith(`${path}/`));
}

/** Cho biết mục điều hướng người học có đang được chọn ở `pathname` hay không. */
export function isLearnerRouteActive(pathname: string, href: string): boolean {
  if (matchesPath(pathname, href)) return true;
  return (ALIAS_PATHS_BY_HREF[href] ?? []).some((path) => matchesPath(pathname, path));
}
