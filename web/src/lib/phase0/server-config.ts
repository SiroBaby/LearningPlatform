import "server-only";

export interface Phase0ServerConfig {
  readonly apiBaseUrl: string;
  readonly ownerId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readEnvironmentValue(name: "PHASE0_API_BASE_URL" | "PHASE0_DEV_OWNER_ID"): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be configured for the Phase 0 BFF.`);
  }
  return value;
}

function readApiBaseUrl(): string {
  const value = readEnvironmentValue("PHASE0_API_BASE_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PHASE0_API_BASE_URL must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PHASE0_API_BASE_URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function readOwnerId(): string {
  const value = readEnvironmentValue("PHASE0_DEV_OWNER_ID");
  if (!UUID_PATTERN.test(value)) {
    throw new Error("PHASE0_DEV_OWNER_ID must be a UUID.");
  }
  return value;
}

export function getPhase0ServerConfig(): Phase0ServerConfig {
  return { apiBaseUrl: readApiBaseUrl(), ownerId: readOwnerId() };
}
