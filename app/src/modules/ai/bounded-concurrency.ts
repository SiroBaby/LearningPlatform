interface BoundedMapInput<TInput, TOutput> {
  readonly concurrency: number;
  readonly items: readonly TInput[];
  readonly map: (item: TInput) => Promise<TOutput>;
}

export async function mapWithBoundedConcurrency<TInput, TOutput>(
  input: BoundedMapInput<TInput, TOutput>,
): Promise<readonly TOutput[]> {
  const results: Array<TOutput | undefined> = Array.from({ length: input.items.length });
  const entries = input.items.entries();
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const next = entries.next();
      if (next.done) return;
      const [index, item] = next.value;
      try {
        results[index] = await input.map(item);
      } catch (error) {
        if (failure === undefined) failure = error;
        return;
      }
    }
  };
  const workerCount = Math.min(input.concurrency, input.items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failure !== undefined) throw failure;
  const completed = results.filter((result): result is TOutput => result !== undefined);
  if (completed.length !== input.items.length) {
    throw new Error('Bounded workers did not produce every result');
  }
  return completed;
}
