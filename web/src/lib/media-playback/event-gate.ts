/** Events whose position is meaningless while a source swap has not restored the viewer's place. */
const POSITION_EVENT_TYPES: ReadonlySet<string> = new Set(["time", "seeked"]);

export function shouldForwardPlayerEvent(eventType: string, isSwapPending: boolean): boolean {
  return !(isSwapPending && POSITION_EVENT_TYPES.has(eventType));
}
