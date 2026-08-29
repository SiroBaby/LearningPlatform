import { hasAuthenticatedSession } from "@/lib/auth/session";

import { PublicShellContent } from "./public-shell-content";

interface PublicShellProps {
  readonly children: React.ReactNode;
  readonly isAuthenticated?: boolean;
}

/** Renders shared public navigation with the session state resolved on the server. */
export async function PublicShell({ children, isAuthenticated }: PublicShellProps): Promise<React.JSX.Element> {
  const resolvedAuthentication = isAuthenticated ?? await hasAuthenticatedSession();

  return <PublicShellContent isAuthenticated={resolvedAuthentication}>{children}</PublicShellContent>;
}
