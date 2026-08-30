import "server-only";

import { cookies } from "next/headers";

import { requestAuthBackend } from "./backend-client";

/** Checks the opaque access session with Nest before rendering protected UI. */
export async function hasAuthenticatedSession(): Promise<boolean> {
  const accessToken = (await cookies()).get("lp_access")?.value;
  if (!accessToken) return false;

  const response = await requestAuthBackend({
    authorization: `Bearer ${accessToken}`,
    method: "GET",
    path: "/api/v1/auth/me",
  });
  return response.ok;
}
