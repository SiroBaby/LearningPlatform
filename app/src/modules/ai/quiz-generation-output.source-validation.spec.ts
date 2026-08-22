import { describe, expect, it } from '@jest/globals';

import type { GeneratedQuestionOutput } from './contracts/llm-provider.contracts';
import { validateGeneratedQuestionOutputAgainstSource } from './quiz-generation-output.source-validation';

describe('validateGeneratedQuestionOutputAgainstSource', () => {
  it('rejects the copied English explanation observed in live generation', () => {
    const copiedExplanation =
      'The readinessProbe determines whether a Pod is ready to receive traffic, whereas the livenessProbe determines whether the container should be restarted.';
    const output = outputWithOverrides({ explanation: copiedExplanation });

    expect(() => validateGeneratedQuestionOutputAgainstSource(copiedExplanation, output)).toThrow(
      expect.objectContaining({ code: 'GENERATION_OUTPUT_INVALID' }),
    );
  });

  it('rejects a copied English source sentence in the stem with the stable invalid code', () => {
    const sourceText = [
      'The readiness endpoint should respond quickly even during partial startup delays.',
      'The deployment controller uses this signal to avoid routing traffic too early.',
    ].join(' ');
    const output = outputWithOverrides({
      stem: 'The deployment controller uses this signal to avoid routing traffic too early.',
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).toThrow(
      expect.objectContaining({ code: 'GENERATION_OUTPUT_INVALID' }),
    );
  });

  it('rejects a copied English source clause in an option with the stable invalid code', () => {
    const sourceText = [
      'A liveness failure should trigger a restart after repeated unsuccessful health checks.',
      'Operators use this mechanism to recover a stuck container automatically.',
    ].join(' ');
    const output = outputWithOverrides({
      options: [
        {
          content: 'Operators use this mechanism to recover a stuck container automatically.',
          isCorrect: true,
        },
        {
          content: 'Kubernetes bỏ qua probe nếu Pod chưa được tạo.',
          isCorrect: false,
        },
      ],
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).toThrow(
      expect.objectContaining({ code: 'GENERATION_OUTPUT_INVALID' }),
    );
  });

  it('rejects a copied English clause that includes a hyphenated token and identifier with digits', () => {
    const sourceText = [
      'Rotate session-token before oauth2-flow callback validation reaches api gateway enforcement.',
      'This release note documents the exact security clause for the lesson.',
    ].join(' ');
    const output = outputWithOverrides({
      explanation:
        'Rotate session-token before oauth2-flow callback validation reaches api gateway enforcement.',
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).toThrow(
      expect.objectContaining({ code: 'GENERATION_OUTPUT_INVALID' }),
    );
  });

  it('rejects repeated one-character-token sequences without candidate-start amplification', () => {
    const repeatedTokens = Array.from({ length: 64 }, () => 'a').join(' ');
    const output = outputWithOverrides({
      stem: repeatedTokens,
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(repeatedTokens, output)).toThrow(
      expect.objectContaining({ code: 'GENERATION_OUTPUT_INVALID' }),
    );
  });

  it('allows Vietnamese learner-facing prose that keeps exact readinessProbe and livenessProbe identifiers', () => {
    const sourceText = [
      'Configure readinessProbe and livenessProbe for the Deployment health policy.',
      'The platform uses these exact identifiers in the manifest.',
    ].join(' ');
    const output = outputWithOverrides({
      explanation:
        'Giải thích bằng tiếng Việt: readinessProbe kiểm tra khả năng nhận traffic, còn livenessProbe phát hiện container bị treo.',
      options: [
        {
          content: 'readinessProbe kiểm tra khả năng nhận traffic.',
          isCorrect: true,
        },
        {
          content: 'livenessProbe chỉ dùng để đặt số replica.',
          isCorrect: false,
        },
      ],
      stem: 'Phát biểu nào mô tả đúng vai trò của readinessProbe và livenessProbe?',
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).not.toThrow();
  });

  it('allows short English technical phrases even when they also appear in the source', () => {
    const sourceText = [
      'The dashboard records HTTP 200 responses and CPU usage during the release check.',
      'These short technical phrases are expected to remain unchanged in quiz content.',
    ].join(' ');
    const output = outputWithOverrides({
      explanation:
        'Giải thích bằng tiếng Việt: chỉ số HTTP 200 và CPU usage cho biết dịch vụ vẫn phản hồi bình thường.',
      options: [
        { content: 'HTTP 200 cho biết request thành công.', isCorrect: true },
        { content: 'CPU usage luôn là lỗi hệ thống.', isCorrect: false },
      ],
      stem: 'Cụm technical term nào trong source diễn tả phản hồi thành công?',
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).not.toThrow();
  });

  it('allows grounded Vietnamese explanation copied from a Vietnamese source sentence with English technical terms', () => {
    const sourceText = [
      'Bài học nhấn mạnh cách bảo vệ thông tin xác thực trong ứng dụng web.',
      'Access token phải được gửi qua Authorization header và không nên xuất hiện trong query string vì URL có thể bị lưu trong lịch sử trình duyệt hoặc log trung gian.',
    ].join(' ');
    const output = outputWithOverrides({
      explanation:
        'Access token phải được gửi qua Authorization header và không nên xuất hiện trong query string vì URL có thể bị lưu trong lịch sử trình duyệt hoặc log trung gian.',
      stem: 'Vì sao Access token không nên xuất hiện trong query string?',
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).not.toThrow();
  });

  it('allows Vietnamese prose with decomposed combining marks because normalization preserves the non-English barrier', () => {
    const sourceText = [
      'Tài liệu này mô tả cách Access token được gửi qua Authorization header để tránh rò rỉ qua query string.',
      'Người học cần hiểu vì sao URL có thể bị lưu trong lịch sử trình duyệt hoặc log trung gian.',
    ].join(' ');
    const output = outputWithOverrides({
      explanation:
        'Giải thích cho người học: Access token nên được gửi qua Authorization header thay vì query string vì URL dễ bị lưu trong lịch sử trình duyệt hoặc log trung gian.',
      stem: 'Vì sao Access token không nên xuất hiện trong query string?',
    });

    expect(() => validateGeneratedQuestionOutputAgainstSource(sourceText, output)).not.toThrow();
  });
});

function outputWithOverrides(
  overrides: Partial<GeneratedQuestionOutput['questions'][number]>,
): GeneratedQuestionOutput {
  return {
    questions: [
      {
        explanation: 'Giải thích mặc định bằng tiếng Việt để tránh lặp nguyên văn source.',
        options: [
          { content: 'Lựa chọn đúng mặc định.', isCorrect: true },
          { content: 'Lựa chọn sai mặc định.', isCorrect: false },
        ],
        stem: 'Câu hỏi mặc định bằng tiếng Việt.',
        ...overrides,
      },
    ],
  };
}
