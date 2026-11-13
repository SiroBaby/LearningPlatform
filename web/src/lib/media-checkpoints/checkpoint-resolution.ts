/** Pure decisions about how an open checkpoint ends; kept out of React so they can be tested. */

interface QuestionGroupLike {
  readonly questionIds: readonly string[];
}

type AnsweredLike = Readonly<Record<string, unknown>>;

/** First question of the group (after `afterQuestionId`, if given) that has no answer yet. */
export function findNextUnansweredQuestionId(
  group: QuestionGroupLike | undefined,
  answered: AnsweredLike,
  afterQuestionId: string | null = null,
): string | null {
  if (!group) return null;
  const startIndex = afterQuestionId === null ? 0 : group.questionIds.indexOf(afterQuestionId) + 1;
  return group.questionIds.slice(startIndex).find((questionId) => !(questionId in answered)) ?? null;
}

/**
 * Pressing Play on the native controls ends the open checkpoint. It counts as answered when
 * the learner already answered every question of the group (for example while reviewing the
 * source after checking), and as skipped otherwise.
 */
export function decideNativePlayOutcome(
  group: QuestionGroupLike | undefined,
  answered: AnsweredLike,
): "answered" | "skipped" {
  return group !== undefined && findNextUnansweredQuestionId(group, answered) === null ? "answered" : "skipped";
}
