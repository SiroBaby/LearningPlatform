const PUBLIC_ORIGIN_ENV = "WEB_PUBLIC_ORIGIN";
const LOCAL_PUBLIC_ORIGIN_ENV = "WEB_LOCAL_PUBLIC_ORIGIN";

function parsePublicOrigin(value: string, source: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${source} must be an absolute HTTP(S) URL`);
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${source} must be an origin without credentials, path, query, or fragment`);
  }

  return url.origin;
}

export function getWebPublicOrigin(): string {
  const configured = process.env[PUBLIC_ORIGIN_ENV]?.trim();
  if (configured) return parsePublicOrigin(configured, PUBLIC_ORIGIN_ENV);

  if (process.env.NODE_ENV !== "production") {
    const local = process.env[LOCAL_PUBLIC_ORIGIN_ENV]?.trim();
    if (local) return parsePublicOrigin(local, LOCAL_PUBLIC_ORIGIN_ENV);
  }

  throw new Error(`${PUBLIC_ORIGIN_ENV} must be configured`);
}

export function getWebPublicUrl(pathname: string): URL {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("Redirect pathname must be an absolute path");
  }
  return new URL(pathname, `${getWebPublicOrigin()}/`);
}
