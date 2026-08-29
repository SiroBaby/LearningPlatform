const GENERIC_CSRF_ERROR = {
  code: "CSRF_REJECTED",
  message: "Yêu cầu không hợp lệ",
} as const;

function configuredOrigins(): Set<string> {
  const values = [process.env.WEB_PUBLIC_ORIGIN];
  if (process.env.NODE_ENV !== "production") values.push(process.env.WEB_LOCAL_PUBLIC_ORIGIN);
  return new Set(values.filter((value): value is string => Boolean(value)).map((value) => new URL(value).origin));
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin;
  const referer = request.headers.get("referer")?.trim();
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Validate browser provenance before an authenticated BFF mutation. */
export function validateBrowserMutation(request: Request): Response | null {
  const origin = requestOrigin(request);
  if (!origin || !configuredOrigins().has(origin)) return Response.json(GENERIC_CSRF_ERROR, { status: 403 });

  const fetchSite = request.headers.get("sec-fetch-site")?.trim();
  if (fetchSite && fetchSite !== "same-origin") return Response.json(GENERIC_CSRF_ERROR, { status: 403 });
  return null;
}
