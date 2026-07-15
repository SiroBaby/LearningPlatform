import type {
  GeneratedOptionOutput,
  GeneratedQuestionOutput,
  GeneratedQuestionOutputItem,
} from './contracts/llm-provider.contracts';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';

export function decodeGeneratedQuestionOutput(value: unknown): GeneratedQuestionOutput {
  const output = readObject(value);
  requireExactKeys(output, ['questions']);
  const questions = output.questions;
  if (!Array.isArray(questions)) throw malformedOutput();
  return { questions: questions.map(decodeQuestion) };
}

function decodeQuestion(value: unknown): GeneratedQuestionOutputItem {
  const question = readObject(value);
  requireExactKeys(question, ['explanation', 'options', 'stem']);
  const options = question.options;
  if (!Array.isArray(options)) throw malformedOutput();
  return {
    explanation: readString(question.explanation),
    options: options.map(decodeOption),
    stem: readString(question.stem),
  };
}

function decodeOption(value: unknown): GeneratedOptionOutput {
  const option = readObject(value);
  requireExactKeys(option, ['content', 'isCorrect']);
  return {
    content: readString(option.content),
    isCorrect: readBoolean(option.isCorrect),
  };
}

function readObject(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) throw malformedOutput();
  return value;
}

function readString(value: unknown): string {
  if (typeof value !== 'string') throw malformedOutput();
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw malformedOutput();
  return value;
}

function requireExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const actualKeys = Object.keys(value);
  const hasExpectedKeys = expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (actualKeys.length !== expectedKeys.length || !hasExpectedKeys) throw malformedOutput();
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformedOutput(): QuizGenerationError {
  return new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
}
