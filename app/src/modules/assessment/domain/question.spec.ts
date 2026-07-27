import { randomUUID } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import type { QuestionCandidate } from '../contracts/quiz-generation-handoff.contract';
import { Question } from './question';

describe('Question', () => {
  it('accepts a structurally valid single-select question', () => {
    const question = Question.create(candidate(), randomUUID());

    expect(question?.options).toHaveLength(2);
    expect(question?.options.filter((option) => option.isCorrect)).toHaveLength(1);
    expect(question?.citation.snippet).toBe('A source excerpt.');
  });

  const invalidCandidates: readonly {
    readonly reason: string;
    readonly build: (valid: QuestionCandidate) => QuestionCandidate;
  }[] = [
    { reason: 'blank stem', build: (valid) => ({ ...valid, stem: '   ' }) },
    { reason: 'blank explanation', build: (valid) => ({ ...valid, explanation: '   ' }) },
    { reason: 'blank citation snippet', build: (valid) => ({ ...valid, citation: { ...valid.citation, snippet: '   ' } }) },
    { reason: 'citation for a different chunk', build: (valid) => ({ ...valid, citation: { ...valid.citation, chunkId: randomUUID() } }) },
    { reason: 'invalid locator', build: (valid) => ({ ...valid, citation: { ...valid.citation, locator: { kind: 'page', page: 0 } } }) },
    { reason: 'negative chunk index', build: (valid) => ({ ...valid, chunkIndex: -1 }) },
    { reason: 'negative ordinal', build: (valid) => ({ ...valid, ordinal: -1 }) },
    { reason: 'duplicate options', build: (valid) => ({ ...valid, options: [{ content: 'Answer', isCorrect: true }, { content: ' answer ', isCorrect: false }] }) },
    { reason: 'two correct options', build: (valid) => ({ ...valid, options: [{ content: 'One', isCorrect: true }, { content: 'Two', isCorrect: true }] }) },
  ];

  it.each(invalidCandidates)('rejects a candidate with $reason', ({ build }) => {
    expect(Question.create(build(candidate()), randomUUID())).toBeNull();
  });

  function candidate(): QuestionCandidate {
    const chunkId = randomUUID();
    return {
      chunkId,
      chunkIndex: 0,
      ordinal: 0,
      stem: 'What does the source establish?',
      explanation: 'The source directly establishes the answer.',
      options: [
        { content: 'It establishes the claim.', isCorrect: true },
        { content: 'It disproves the claim.', isCorrect: false },
      ],
      citation: {
        chunkId,
        locator: { kind: 'page', page: 1 },
        snippet: 'A source excerpt.',
      },
    };
  }
});
