/**
 * Turns the time ranges of served quiz questions into checkpoints: the moments where
 * the player stops and asks. Pure code (no React) so it runs under `node --test`.
 */

export interface CheckpointQuestionInput {
  readonly id: string;
  /** Position in the served list; the learner sees `servedIndex + 1`. */
  readonly servedIndex: number;
  readonly timeRange: { readonly startSec: number; readonly endSec: number } | null;
}

export interface CheckpointScheduleOptions {
  /** Media length once known; null before metadata loads. */
  readonly durationSec: number | null;
  /** Questions whose moments are this close share one stop. */
  readonly groupWindowSec?: number;
  /** A stop never lands closer than this to the end of the media. */
  readonly endGuardSec?: number;
}

export interface CheckpointGroup {
  /** Id of the earliest question of the group; stays the same when the duration arrives later. */
  readonly id: string;
  readonly atSec: number;
  /** Earliest source start in the group, used by "go to this part". */
  readonly startSec: number;
  /** Question ids in served order. */
  readonly questionIds: readonly string[];
}

const DEFAULT_GROUP_WINDOW_SEC = 2;
const DEFAULT_END_GUARD_SEC = 0.5;

interface PlacedQuestion {
  readonly id: string;
  readonly servedIndex: number;
  readonly atSec: number;
  readonly startSec: number;
}

function isValidTimeRange(range: CheckpointQuestionInput["timeRange"]): range is { startSec: number; endSec: number } {
  return range !== null
    && Number.isFinite(range.startSec)
    && Number.isFinite(range.endSec)
    && range.startSec >= 0
    && range.endSec >= range.startSec;
}

function clampAtSec(endSec: number, durationSec: number | null, endGuardSec: number): number {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) return endSec;
  return Math.min(endSec, Math.max(0, durationSec - endGuardSec));
}

function compareByTimeThenIndex(left: PlacedQuestion, right: PlacedQuestion): number {
  return left.atSec - right.atSec || left.servedIndex - right.servedIndex;
}

function toGroup(members: readonly PlacedQuestion[]): CheckpointGroup {
  const orderedByServedIndex = [...members].sort((left, right) => left.servedIndex - right.servedIndex);
  return {
    id: members[0].id,
    atSec: Math.max(...members.map((member) => member.atSec)),
    startSec: Math.min(...members.map((member) => member.startSec)),
    questionIds: orderedByServedIndex.map((member) => member.id),
  };
}

export function buildCheckpointGroups(
  questions: readonly CheckpointQuestionInput[],
  options: CheckpointScheduleOptions,
): readonly CheckpointGroup[] {
  const groupWindowSec = options.groupWindowSec ?? DEFAULT_GROUP_WINDOW_SEC;
  const endGuardSec = options.endGuardSec ?? DEFAULT_END_GUARD_SEC;
  const placed: PlacedQuestion[] = [];
  for (const question of questions) {
    if (!isValidTimeRange(question.timeRange)) continue;
    placed.push({
      id: question.id,
      servedIndex: question.servedIndex,
      atSec: clampAtSec(question.timeRange.endSec, options.durationSec, endGuardSec),
      startSec: question.timeRange.startSec,
    });
  }
  placed.sort(compareByTimeThenIndex);

  const groups: CheckpointGroup[] = [];
  let members: PlacedQuestion[] = [];
  for (const question of placed) {
    if (members.length > 0 && question.atSec - members[0].atSec > groupWindowSec) {
      groups.push(toGroup(members));
      members = [];
    }
    members.push(question);
  }
  if (members.length > 0) groups.push(toGroup(members));
  return groups.sort((left, right) => left.atSec - right.atSec || left.id.localeCompare(right.id));
}
