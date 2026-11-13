/**
 * Checkpoint answers kept in the browser tab. Pure parse/serialize helpers; the component
 * decides when to touch storage (only after mount).
 */

export type CheckpointAnswerMap = Readonly<Record<string, boolean | null>>;

export interface CheckpointProgress {
  readonly v: 1;
  readonly answered: CheckpointAnswerMap;
}

const STORAGE_KEY_PREFIX = "learning-platform:media-checkpoints:";

export function getCheckpointProgressKey(quizId: string): string {
  return `${STORAGE_KEY_PREFIX}${quizId}`;
}

function isAnswerValue(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

/** Returns an empty map for anything that is not valid saved progress. */
export function parseCheckpointProgress(raw: string | null): CheckpointAnswerMap {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || typeof record.answered !== "object" || record.answered === null) return {};
    const entries = Object.entries(record.answered as Record<string, unknown>)
      .filter((entry): entry is [string, boolean | null] => isAnswerValue(entry[1]));
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function serializeCheckpointProgress(answered: CheckpointAnswerMap): string {
  const progress: CheckpointProgress = { v: 1, answered };
  return JSON.stringify(progress);
}

/** Ids of groups whose every question was answered; unknown questions never count. */
export function findAnsweredGroupIds(
  groups: readonly { readonly id: string; readonly questionIds: readonly string[] }[],
  answered: CheckpointAnswerMap,
): readonly string[] {
  return groups
    .filter((group) => group.questionIds.every((questionId) => questionId in answered))
    .map((group) => group.id);
}
