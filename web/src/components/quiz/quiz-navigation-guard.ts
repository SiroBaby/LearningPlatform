export interface ConfirmNavigationOptions {
  readonly persistDraft?: boolean;
}

export interface QuizNavigationGuardActions {
  readonly markConfirmed: () => void;
  readonly cleanup: () => void;
  readonly onBeforeConfirmedLeave?: () => void;
  readonly persistDraft: () => void;
}

export function confirmQuizNavigation(
  actions: QuizNavigationGuardActions,
  options: ConfirmNavigationOptions = {},
): void {
  actions.markConfirmed();
  actions.cleanup();
  actions.onBeforeConfirmedLeave?.();
  if (options.persistDraft !== false) {
    actions.persistDraft();
  }
}
