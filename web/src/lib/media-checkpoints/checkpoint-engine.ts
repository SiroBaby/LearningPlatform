/**
 * Decides when playback must stop for a checkpoint. A pure reducer: every event returns the
 * next state plus at most one effect for the controller to run. No React, no DOM.
 */
import type { CheckpointGroup } from "./checkpoint-schedule.ts";

export type CheckpointStatus = "upcoming" | "open" | "answered" | "passed";

export interface CheckpointEngineState {
  readonly groups: readonly CheckpointGroup[];
  readonly statuses: Readonly<Record<string, CheckpointStatus>>;
  /** Null until the first tick after groups load: that tick is only a baseline. */
  readonly lastTimeSec: number | null;
  readonly lastWallMs: number | null;
  readonly openGroupId: string | null;
  /** Position the open stop was reached from; later stops are searched after it. */
  readonly crossFromSec: number | null;
  readonly resumeAtSec: number | null;
  readonly enabled: boolean;
  readonly emitsSeekEvents: boolean;
}

export type CheckpointEngineEvent =
  | { readonly type: "TICK"; readonly timeSec: number; readonly nowMs: number; readonly playbackRate: number }
  | { readonly type: "SEEKED"; readonly timeSec: number }
  | { readonly type: "ENDED"; readonly timeSec: number }
  | { readonly type: "PAUSED_AT"; readonly timeSec: number }
  | { readonly type: "RESOLVE"; readonly groupId: string; readonly outcome: "answered" | "skipped" }
  | { readonly type: "SET_ENABLED"; readonly enabled: boolean }
  | { readonly type: "RESTORE_ANSWERED"; readonly groupIds: readonly string[] }
  | { readonly type: "GROUPS_CHANGED"; readonly groups: readonly CheckpointGroup[] };

export type CheckpointEngineEffect =
  | { readonly type: "PAUSE"; readonly groupId: string }
  | { readonly type: "RESUME"; readonly timeSec: number }
  | { readonly type: "OPEN_NEXT"; readonly groupId: string }
  | null;

export interface CheckpointEngineResult {
  readonly state: CheckpointEngineState;
  readonly effect: CheckpointEngineEffect;
}

export interface CreateCheckpointEngineOptions {
  readonly groups: readonly CheckpointGroup[];
  readonly enabled: boolean;
  /** HTML media elements fire `seeked`; a polling adapter (YouTube) does not. */
  readonly emitsSeekEvents: boolean;
}

/** A tick may land a hair before the stop and still count as reaching it. */
const REACH_TOLERANCE_SEC = 0.05;
/** Position changes smaller than this are noise (source swap restore), not a seek. */
const SEEK_NOISE_SEC = 0.3;
const MIN_FORWARD_JUMP_SEC = 1.5;
const JUMP_RATE_FACTOR = 1.5;
const JUMP_SLACK_SEC = 0.5;
const NEAR_WINDOW_SEC = 1;

export function createCheckpointEngine(options: CreateCheckpointEngineOptions): CheckpointEngineState {
  return {
    groups: options.groups,
    statuses: Object.fromEntries(options.groups.map((group) => [group.id, "upcoming" as const])),
    lastTimeSec: null,
    lastWallMs: null,
    openGroupId: null,
    crossFromSec: null,
    resumeAtSec: null,
    enabled: options.enabled,
    emitsSeekEvents: options.emitsSeekEvents,
  };
}

export function getCheckpointStatus(state: CheckpointEngineState, groupId: string): CheckpointStatus {
  return state.statuses[groupId] ?? "upcoming";
}

function withStatuses(
  state: CheckpointEngineState,
  updates: ReadonlyArray<readonly [string, CheckpointStatus]>,
): CheckpointEngineState {
  if (updates.length === 0) return state;
  return { ...state, statuses: { ...state.statuses, ...Object.fromEntries(updates) } };
}

function done(state: CheckpointEngineState, effect: CheckpointEngineEffect = null): CheckpointEngineResult {
  return { state, effect };
}

function selectGroups(
  state: CheckpointEngineState,
  predicate: (group: CheckpointGroup, status: CheckpointStatus) => boolean,
): readonly CheckpointGroup[] {
  return state.groups.filter((group) => predicate(group, getCheckpointStatus(state, group.id)));
}

/** First load of a position: stops already behind it can no longer fire. */
function applyBaseline(state: CheckpointEngineState, timeSec: number, nowMs: number | null): CheckpointEngineState {
  const behind = selectGroups(state, (group, status) => status === "upcoming" && group.atSec <= timeSec);
  const next = withStatuses(state, behind.map((group) => [group.id, "passed"] as const));
  return { ...next, lastTimeSec: timeSec, lastWallMs: nowMs };
}

/** A real jump of the position (explicit or detected): forward skips stops, backward re-arms them. */
function applySeek(state: CheckpointEngineState, timeSec: number): CheckpointEngineState {
  const from = state.lastTimeSec ?? timeSec;
  let next = state;
  if (timeSec < from) {
    const rearmed = selectGroups(state, (group, status) => status === "passed" && group.atSec > timeSec);
    next = withStatuses(state, rearmed.map((group) => [group.id, "upcoming"] as const));
  } else if (timeSec > from) {
    const skipped = selectGroups(state, (group, status) => (
      status === "upcoming" && group.atSec > from && group.atSec <= timeSec
    ));
    next = withStatuses(state, skipped.map((group) => [group.id, "passed"] as const));
  }
  return {
    ...next,
    lastTimeSec: timeSec,
    lastWallMs: null,
    resumeAtSec: next.openGroupId === null ? next.resumeAtSec : timeSec,
  };
}

function isImplicitSeek(state: CheckpointEngineState, event: Extract<CheckpointEngineEvent, { type: "TICK" }>): boolean {
  if (state.lastTimeSec === null) return false;
  const delta = event.timeSec - state.lastTimeSec;
  if (delta < -SEEK_NOISE_SEC) return true;
  const wallDeltaSec = state.lastWallMs === null ? 0 : Math.max(0, event.nowMs - state.lastWallMs) / 1000;
  const expectedAdvanceSec = wallDeltaSec * Math.max(event.playbackRate, 0) * JUMP_RATE_FACTOR + JUMP_SLACK_SEC;
  return delta > Math.max(MIN_FORWARD_JUMP_SEC, expectedAdvanceSec);
}

function findReachedGroups(state: CheckpointEngineState, fromSec: number, toSec: number): readonly CheckpointGroup[] {
  return selectGroups(state, (group, status) => (
    status === "upcoming" && group.atSec > fromSec && group.atSec <= toSec + REACH_TOLERANCE_SEC
  ));
}

function advanceTo(
  state: CheckpointEngineState,
  timeSec: number,
  nowMs: number | null,
): CheckpointEngineResult {
  const fromSec = state.lastTimeSec ?? timeSec;
  const reached = findReachedGroups(state, fromSec, timeSec);
  const moved: CheckpointEngineState = { ...state, lastTimeSec: timeSec, lastWallMs: nowMs };
  if (reached.length === 0) return done(moved);
  if (!state.enabled) {
    return done(withStatuses(moved, reached.map((group) => [group.id, "passed"] as const)));
  }
  const target = reached[0];
  const opened = withStatuses(moved, [[target.id, "open"]]);
  return done(
    { ...opened, openGroupId: target.id, crossFromSec: fromSec, resumeAtSec: timeSec },
    { type: "PAUSE", groupId: target.id },
  );
}

/** True while the next stop is close enough that the controller should poll every frame. */
export function isNearCheckpoint(state: CheckpointEngineState, timeSec: number, windowSec = NEAR_WINDOW_SEC): boolean {
  if (!state.enabled || state.openGroupId !== null) return false;
  return state.groups.some((group) => (
    getCheckpointStatus(state, group.id) === "upcoming" && group.atSec > timeSec && group.atSec - timeSec < windowSec
  ));
}

function reduceTick(state: CheckpointEngineState, event: Extract<CheckpointEngineEvent, { type: "TICK" }>): CheckpointEngineResult {
  if (state.lastTimeSec === null) return done(applyBaseline(state, event.timeSec, event.nowMs));
  if (isImplicitSeek(state, event)) {
    return done({ ...applySeek(state, event.timeSec), lastWallMs: event.nowMs });
  }
  if (state.openGroupId !== null) {
    return done({ ...state, lastTimeSec: event.timeSec, lastWallMs: event.nowMs });
  }
  return advanceTo(state, event.timeSec, event.nowMs);
}

function reduceSeeked(state: CheckpointEngineState, timeSec: number): CheckpointEngineResult {
  if (state.lastTimeSec === null) return done(applyBaseline(state, timeSec, null));
  if (Math.abs(timeSec - state.lastTimeSec) < SEEK_NOISE_SEC) {
    return done({ ...state, lastTimeSec: timeSec });
  }
  return done(applySeek(state, timeSec));
}

function reduceEnded(state: CheckpointEngineState, timeSec: number): CheckpointEngineResult {
  if (state.lastTimeSec === null) return done(applyBaseline(state, timeSec, null));
  if (state.openGroupId !== null) return done({ ...state, lastTimeSec: timeSec });
  return advanceTo(state, timeSec, null);
}

function reducePausedAt(state: CheckpointEngineState, timeSec: number): CheckpointEngineResult {
  if (state.openGroupId === null) return done(state);
  return done({ ...state, lastTimeSec: timeSec, resumeAtSec: timeSec });
}

function findNextOpenable(state: CheckpointEngineState, resumeAtSec: number): CheckpointGroup | null {
  if (!state.enabled || state.crossFromSec === null) return null;
  const crossFromSec = state.crossFromSec;
  const candidates = selectGroups(state, (group, status) => (
    status === "upcoming" && group.atSec > crossFromSec && group.atSec <= resumeAtSec + REACH_TOLERANCE_SEC
  ));
  return candidates[0] ?? null;
}

function reduceResolve(
  state: CheckpointEngineState,
  event: Extract<CheckpointEngineEvent, { type: "RESOLVE" }>,
): CheckpointEngineResult {
  if (state.openGroupId === null || state.openGroupId !== event.groupId) return done(state);
  const settled = withStatuses(state, [[event.groupId, event.outcome === "answered" ? "answered" : "passed"]]);
  const resumeAtSec = settled.resumeAtSec ?? settled.lastTimeSec ?? 0;
  const next = findNextOpenable(settled, resumeAtSec);
  if (next !== null) {
    const opened = withStatuses(settled, [[next.id, "open"]]);
    return done({ ...opened, openGroupId: next.id }, { type: "OPEN_NEXT", groupId: next.id });
  }
  return done(
    {
      ...settled,
      openGroupId: null,
      crossFromSec: null,
      resumeAtSec: null,
      lastTimeSec: resumeAtSec,
      lastWallMs: null,
    },
    { type: "RESUME", timeSec: resumeAtSec },
  );
}

function reduceSetEnabled(state: CheckpointEngineState, enabled: boolean): CheckpointEngineResult {
  const next = { ...state, enabled };
  if (enabled || state.openGroupId === null) return done(next);
  return reduceResolve(next, { type: "RESOLVE", groupId: state.openGroupId, outcome: "skipped" });
}

function reduceRestoreAnswered(state: CheckpointEngineState, groupIds: readonly string[]): CheckpointEngineResult {
  const restorable = groupIds.filter((id) => id in state.statuses && id !== state.openGroupId);
  return done(withStatuses(state, restorable.map((id) => [id, "answered"] as const)));
}

function reduceGroupsChanged(state: CheckpointEngineState, groups: readonly CheckpointGroup[]): CheckpointEngineResult {
  const statuses = Object.fromEntries(groups.map((group) => [group.id, state.statuses[group.id] ?? "upcoming"]));
  const hasOpenGroup = state.openGroupId !== null && state.openGroupId in statuses;
  return done({
    ...state,
    groups,
    statuses,
    lastTimeSec: null,
    lastWallMs: null,
    openGroupId: hasOpenGroup ? state.openGroupId : null,
    crossFromSec: hasOpenGroup ? state.crossFromSec : null,
    resumeAtSec: hasOpenGroup ? state.resumeAtSec : null,
  });
}

export function reduceCheckpointEngine(
  state: CheckpointEngineState,
  event: CheckpointEngineEvent,
): CheckpointEngineResult {
  switch (event.type) {
    case "TICK": return reduceTick(state, event);
    case "SEEKED": return reduceSeeked(state, event.timeSec);
    case "ENDED": return reduceEnded(state, event.timeSec);
    case "PAUSED_AT": return reducePausedAt(state, event.timeSec);
    case "RESOLVE": return reduceResolve(state, event);
    case "SET_ENABLED": return reduceSetEnabled(state, event.enabled);
    case "RESTORE_ANSWERED": return reduceRestoreAnswered(state, event.groupIds);
    case "GROUPS_CHANGED": return reduceGroupsChanged(state, event.groups);
  }
}
