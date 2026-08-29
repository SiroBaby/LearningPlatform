export const AUTH_ENTRY_PATHS = ["/login", "/signup"] as const;

export function isAuthEntryPath(pathname: string): boolean {
  return AUTH_ENTRY_PATHS.some((entryPath) => entryPath === pathname);
}

/** Keeps authenticated users out of the Google sign-in entry pages. */
export function getAuthEntryRedirectPath(isAuthenticated: boolean): "/home" | null {
  return isAuthenticated ? "/home" : null;
}
