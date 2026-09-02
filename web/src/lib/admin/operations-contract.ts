export type AdminOperationsState = "healthy" | "degraded" | "unavailable";

export interface AdminRoleChangeRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly targetUserId: string;
  readonly desiredRole: "ADMIN" | "SUPER_ADMIN";
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly approvalCount: number;
  readonly requiredApprovals: 2;
  readonly canApprove: boolean;
}

export interface AdminRoleChangeRequestList {
  readonly items: readonly AdminRoleChangeRequest[];
  readonly nextCursor: string | null;
}

export interface AdminSuperAdminBootstrapStatus {
  readonly mode: AdminSuperAdminMode;
}

export type AdminSuperAdminMode =
  | "FIRST_BOOTSTRAP"
  | "SEED_SECOND"
  | "NORMAL"
  | "QUORUM_RECOVERY"
  | "LOCKOUT_RECOVERY";

export interface AdminOperationsSnapshot {
  readonly health: AdminOperationsState;
  readonly readiness: AdminOperationsState;
  readonly jobs: Readonly<Record<"pending" | "running" | "completed" | "cancelled" | "failed", number>>;
  readonly failures: readonly { readonly code: string; readonly count: number }[];
  readonly resources: readonly { readonly name: string; readonly status: AdminOperationsState }[];
}

export type AdminOperationsResult =
  | { readonly kind: "snapshot"; readonly snapshot: AdminOperationsSnapshot }
  | { readonly kind: "unauthenticated" | "forbidden" | "unavailable" };

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseAdminRoleChangeRequestList(value: unknown): AdminRoleChangeRequestList | null {
  const payload = asRecord(value);
  if (!payload || !Array.isArray(payload.items)) return null;
  if (payload.nextCursor !== null && typeof payload.nextCursor !== "string") return null;

  const items: AdminRoleChangeRequest[] = [];
  for (const item of payload.items) {
    const request = asRecord(item);
    const createdAt = request?.createdAt;
    const approvalCount = request?.approvalCount;
    const allowedFields = new Set([
      "id",
      "requesterId",
      "targetUserId",
      "desiredRole",
      "createdAt",
      "expiresAt",
      "approvalCount",
      "requiredApprovals",
      "canApprove",
    ]);
    if (
      !request ||
      Object.keys(request).some((key) => !allowedFields.has(key)) ||
      Object.keys(request).length < allowedFields.size - 1 ||
      typeof request.id !== "string" || !UUID_PATTERN.test(request.id) ||
      typeof request.requesterId !== "string" || !UUID_PATTERN.test(request.requesterId) ||
      typeof request.targetUserId !== "string" || !UUID_PATTERN.test(request.targetUserId) ||
      (request.desiredRole !== "ADMIN" && request.desiredRole !== "SUPER_ADMIN") ||
      typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt)) ||
      (request.expiresAt !== undefined && request.expiresAt !== null && (typeof request.expiresAt !== "string" || Number.isNaN(Date.parse(request.expiresAt)))) ||
      typeof approvalCount !== "number" || !Number.isInteger(approvalCount) || approvalCount < 0 || approvalCount > 2 ||
      request.requiredApprovals !== 2 || typeof request.canApprove !== "boolean"
    ) return null;
    items.push({
      id: request.id,
      requesterId: request.requesterId,
      targetUserId: request.targetUserId,
      desiredRole: request.desiredRole,
      createdAt,
      expiresAt: request.expiresAt === undefined ? null : request.expiresAt,
      approvalCount,
      requiredApprovals: 2,
      canApprove: request.canApprove,
    });
  }
  return { items, nextCursor: payload.nextCursor as string | null };
}

export function parseAdminSuperAdminBootstrapStatus(value: unknown): AdminSuperAdminBootstrapStatus | null {
  const payload = asRecord(value);
  if (!payload || Object.keys(payload).length !== 1 || !isAdminSuperAdminMode(payload.mode)) return null;
  return { mode: payload.mode };
}

function isAdminSuperAdminMode(value: unknown): value is AdminSuperAdminMode {
  return value === "FIRST_BOOTSTRAP"
    || value === "SEED_SECOND"
    || value === "NORMAL"
    || value === "QUORUM_RECOVERY"
    || value === "LOCKOUT_RECOVERY";
}

function parseJobs(value: unknown): AdminOperationsSnapshot["jobs"] | null {
  if (!Array.isArray(value)) return null;
  const jobs = { pending: 0, running: 0, completed: 0, cancelled: 0, failed: 0 };
  const seenStatuses = new Set<string>();
  for (const item of value) {
    const job = asRecord(item);
    const count = asCount(job?.count);
    if (count === null) return null;
    if (
      job?.status !== "PENDING" &&
      job?.status !== "RUNNING" &&
      job?.status !== "COMPLETED" &&
      job?.status !== "CANCELLED" &&
      job?.status !== "FAILED"
    ) return null;
    if (seenStatuses.has(job.status)) return null;
    seenStatuses.add(job.status);
    if (job.status === "PENDING") jobs.pending = count;
    else if (job.status === "RUNNING") jobs.running = count;
    else if (job.status === "COMPLETED") jobs.completed = count;
    else if (job.status === "CANCELLED") jobs.cancelled = count;
    else jobs.failed = count;
  }
  return jobs;
}

function parseFailures(value: unknown): AdminOperationsSnapshot["failures"] | null {
  if (!Array.isArray(value)) return null;
  const failures = value.map((item) => {
    const failure = asRecord(item);
    const code = failure?.failureCode;
    const count = asCount(failure?.count);
    return typeof code === "string" && /^[A-Z0-9_]{1,80}$/u.test(code) && count !== null ? { code, count } : null;
  });
  return failures.every((failure) => failure !== null) ? failures as AdminOperationsSnapshot["failures"] : null;
}

function parseResources(value: unknown): AdminOperationsSnapshot["resources"] | null {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "processingJobs") return null;
  return [{ name: "processing-jobs", status: "healthy" }];
}

export function parseAdminOperationsSnapshot(value: unknown): AdminOperationsSnapshot | null {
  const payload = asRecord(value);
  if (!payload || payload.health !== "healthy" || payload.readiness !== "ready") return null;
  const jobs = parseJobs(payload.jobSummary);
  const failures = parseFailures(payload.failureClasses);
  const resources = parseResources(payload.resources);
  return jobs && failures && resources ? { health: "healthy", readiness: "healthy", jobs, failures, resources } : null;
}

export function mapAdminOperationsResponse(status: number, payload: unknown): AdminOperationsResult {
  if (status === 401) return { kind: "unauthenticated" };
  if (status === 403) return { kind: "forbidden" };
  if (status < 200 || status >= 300) return { kind: "unavailable" };
  const snapshot = parseAdminOperationsSnapshot(payload);
  return snapshot ? { kind: "snapshot", snapshot } : { kind: "unavailable" };
}
