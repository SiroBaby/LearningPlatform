// Literal paths keep this module importable by Node tests, which cannot resolve the `@/` alias; they mirror routes.home / routes.landing.
const HOME_PATH = "/home";
const LANDING_PATH = "/";

/** `null` means the session is unknown (for example inside an error boundary). */
export type SessionVisibility = boolean | null;

export type AccountMode = "guest" | "member" | "hidden";

export interface PublicChromeView {
  readonly accountMode: AccountMode;
  readonly showUsageLink: boolean;
}

/** Signed-in learners go to their home; guests and unknown sessions go to the public landing page. */
export function getHomeHref(isAuthenticated: SessionVisibility): string {
  return isAuthenticated === true ? HOME_PATH : LANDING_PATH;
}

/** Unknown sessions hide account actions and private links instead of defaulting to guest. */
export function getPublicChromeView(isAuthenticated: SessionVisibility): PublicChromeView {
  if (isAuthenticated === null) return { accountMode: "hidden", showUsageLink: false };
  return isAuthenticated
    ? { accountMode: "member", showUsageLink: true }
    : { accountMode: "guest", showUsageLink: false };
}
