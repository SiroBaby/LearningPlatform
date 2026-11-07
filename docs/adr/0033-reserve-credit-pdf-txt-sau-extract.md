# ADR-0033: Giữ credit PDF/TXT theo nội dung chữ thật sau bước extract

## Trạng thái

**Owner đã duyệt (b1) trên #281; đã triển khai trong nhánh này.** Tài liệu này sửa đổi phần
"reserve trong `confirmProcessing`/`retryProcessing`" của
[ADR-0022](0022-credit-preflight-processing-retry-and-quiz-state.md) chỉ cho
PDF/TXT dùng Platform Model.

## Bối cảnh

Từ PR #278, confirm PDF/TXT giữ credit theo `ceil(sizeBytes / 4)`. Bằng chứng dev
(#274, 2026-11-07): ước tính 61.906, chi phí thật 14.501 (cao hơn khoảng 4,3
lần). Ví Free 10.000 bị `402 INSUFFICIENT_CREDITS` dù file xử lý được. Owner chọn
hướng 1: ước tính và giữ credit sau khi extract, giống media giữ credit sau probe.

Hiện trạng cần nhớ:

- Extract chạy trong Go (`worker/internal/consumer.processClaimed`: đọc object,
  `processing.Extract`, `ChunkText`, rồi sinh câu hỏi từng chunk trong cùng một
  job `FULL_PIPELINE`). Go `Claim` chỉ nhận `job_type='FULL_PIPELINE'`.
- Go không được ghi bất kỳ dữ liệu `course` nào (`app/AGENTS.md`); Node return
  relay là owner duy nhất của course write. Ví và ledger (`course.owner_credit_wallets`,
  `course.credit_ledger_entries`) nằm trong `course`.
- Media đã có mẫu đúng: job `MEDIA_PROBE` (Go) -> `ai.outbox` `DocumentProbeCompleted`
  -> Node `confirmMediaProbe` reserve + `course.outbox` `DocumentReadyForProcessing`
  -> forward relay tạo job `FULL_PIPELINE`. `FULL_PIPELINE` chỉ tồn tại sau khi
  đã reserve nên không cần trạng thái "tạm dừng".

## Các phương án

| | Mô tả | Đánh giá |
| --- | --- | --- |
| (a) Go tự reserve trong Postgres | Go ghi ví/ledger trong transaction của nó | **Loại.** Phá luật "Go không mutate `course`", cần mở GRANT ghi `course.owner_credit_wallets`/ledger cho role của Go (production Go dùng chung database URL với API, nên về kỹ thuật có thể, nhưng chính sách cấm); hai runtime cùng ghi ví, khó giữ thứ tự khóa Document -> wallet và settle idempotent. |
| (b1) Job extract riêng, mẫu media | Job type mới `TEXT_EXTRACT` (cùng bảng `ai.processing_jobs`): Go extract + chunk rồi chỉ báo số đo `DocumentExtractionCompleted` về `ai.outbox`; Node reserve rồi forward `FULL_PIPELINE` | **Chọn.** Đúng kiến trúc (durable queue, return seam, fence), ví chỉ do Node ghi, không đổi quyền DB. Đổi lại thêm một job type và một event. |
| (b2) Một job, tạm dừng giữa chừng | `FULL_PIPELINE` extract xong thì chuyển trạng thái `AWAITING_RESERVATION`, Node reserve rồi resume | Loại: thêm trạng thái không claim được vào hàng đợi chung, cần event "resume" ngược Go, lease/stuck detector phải hiểu trạng thái mới. Phức tạp hơn b1. |
| (c) Go gọi API nội bộ của Node | Go gọi HTTP để reserve | Loại: đường đồng bộ ngoài hàng đợi bền, mất tính at-least-once/replay, thêm bề mặt xác thực service-to-service. |
| (h) Node tự extract khi confirm | Đọc PDF trong API process để đếm token | Loại: đưa parser PDF vào process API (CPU/RAM, DoS) và lặp lại logic đã nằm ở Go; trái hướng Owner đã chốt (extract ở worker). |

## Quyết định: (b1)

Owner đã duyệt trên #281: job type mới `TEXT_EXTRACT`, một migration expand-only idempotent, sàn lúc confirm `available > 0`, mã
`INSUFFICIENT_CREDITS_AFTER_EXTRACT`, hiệu chỉnh hằng số sau bằng 3-5 file thật.

Luồng:

1. `confirm`/`retry` (Platform Model, PDF/TXT): CAS Document sang `PROCESSING`, tăng `processing_attempt`, kiểm ví với hằng số
   `MINIMUM_AVAILABLE_CREDITS_TO_START = 1` (ví thấp hơn thì `402 INSUFFICIENT_CREDITS`, rollback, không chạy việc nặng cho ví
   rỗng), **không reserve** (`budget_status` giữ nguyên, chưa `RESERVED`), ghi `course.outbox` `DocumentReadyForProcessing` với
   `jobType = TEXT_EXTRACT`. Custom AI không reserve và đi thẳng `FULL_PIPELINE`.
2. Forward relay tạo hàng `TEXT_EXTRACT` trong `ai.processing_jobs` (một hàng mỗi Document; `full_pipeline_job_id` và
   `processing_attempt` mang danh tính reserve). Go claim cùng hàng đợi, lease và retry với `FULL_PIPELINE`.
3. Go (`TEXT_EXTRACT`) đọc object, `Extract`, `ChunkText`, rồi **dừng**: không gọi provider, **không lưu chunk**. Trong một transaction có
   fence (attempt, lease, cancellation marker, revocation) nó đánh dấu job `COMPLETED` và ghi `ai.outbox`
   `DocumentExtractionCompleted` (`documentId`, `ownerId`, `fullPipelineJobId`, `processingAttempt`, `deletionFence`,
   `extractedChars` tính theo ký tự không phải byte, `chunkCount`). Lỗi extract đi đường FAILED hiện có (payload kèm
   `jobType = TEXT_EXTRACT`, không đụng credit).
4. Node return relay gọi `completeExtraction` trong một transaction khóa Document trước, ví sau:
   - `IGNORED` nếu `deletionFence`, `processingAttempt` hoặc `fullPipelineJobId` lệch, hoặc Document không còn `PROCESSING`
     (xóa giữa chừng và attempt mới thắng, không reserve gì).
   - Replay: nếu đã có `course.outbox` `DocumentReadyForProcessing` `FULL_PIPELINE` đúng `(fullPipelineJobId, processingAttempt)`
     (`hasFullPipelineRequest`) thì trả `ALREADY_APPLIED` và không ghi gì thêm; ngoài ra `reserveCredits` với khóa
     `reserve:{fullPipelineJobId}:{processingAttempt}` tự idempotent (`ALREADY_RESERVED`).
   - Đủ ví: ghi `estimated_credits`, `budget_status = RESERVED`, rồi ghi event `FULL_PIPELINE` để forward relay tạo job.
     `FULL_PIPELINE` **extract lại** từ object (không dùng chunk đã lưu), nên không cần cờ "chunk còn mới".
   - Không đủ ví: Document `FAILED`, `INSUFFICIENT_CREDITS_AFTER_EXTRACT` (retryable), `estimated_credits` = mức cần, **không ghi
     event `FULL_PIPELINE`** nên không có provider call, ledger và ví không đổi.
   - Model không còn cấu hình hoặc số đo không hợp lệ: Document `FAILED` `PROCESSING_FAILED`, không reserve.
5. Settlement không đổi: `settle|release|hold:{fullPipelineJobId}:{processingAttempt}` ở return seam (#273); Document `DELETING`
   settle theo #278 vì khóa y hệt. Kết quả của job `TEXT_EXTRACT` mang `jobType` nên projection bỏ qua settlement (nó không bao
   giờ có reservation) và không cảnh báo `job_id_mismatch`; kết quả `FULL_PIPELINE` cũ lệch job id vẫn cảnh báo.

Công thức (hàm thuần `estimateTextCredits`, hằng số trong `credit-estimation.constants.ts`, **heuristic chờ hiệu chỉnh**):

```text
inputTokens  = chunkCount * 200 + ceil(extractedChars / 3)
outputTokens = chunkCount * 600
credits      = max(1, inputTokens * creditPerInputToken + outputTokens * creditPerOutputToken)
```

Go gọi provider một lần mỗi chunk nên phải tính theo `chunkCount`, không theo một lần `COARSE_OUTPUT_TOKEN_CAP`. Để hiệu chỉnh từ log:
`content.extraction.credit_estimated` (`extractedChars`, `chunkCount`, `estimatedCredits`, `model`) và
`content.settlement.actual_usage` (`inputTokens`, `outputTokens`, `totalCredits`) cùng mang `documentId` và `jobId`
(= `fullPipelineJobId`) để nối.

## Idempotency, replay, retry, fence

- Event `DocumentExtractionCompleted` at-least-once: xem `hasFullPipelineRequest` và khóa reserve ở trên; hai bản trùng đồng thời chỉ
  reserve một lần vì cùng khóa Document trước ví.
- Forward event `TEXT_EXTRACT` replay không re-arm job: chỉ re-arm khi `processing_attempt` mới lớn hơn (không dùng `attempts`, vốn tăng
  theo technical retry).
- Retry của Owner: attempt mới, extract lại, khóa reserve mới; attempt cũ không còn RESERVE mở.
- Xóa Document: `cancelAiWork` trong transaction xóa hủy cả `FULL_PIPELINE` lẫn `TEXT_EXTRACT` (và để placeholder CANCELLED cho từng
  loại), `ProcessingJobRepository.cancelDocument` làm tương tự cho cancellation relay; event đến muộn bị fence `IGNORED`.

## Ước tính trước upload

Số theo dung lượng vẫn hiển thị nhưng chỉ là tham khảo: nhãn "ước tính sơ bộ, chưa phải mức giữ". Code hiện không có
`canProcess`/`availableCredits` trong estimate (phần preflight của ADR-0022 chưa được triển khai), nên không có gì chặn ví Free ở bước
upload; confirm chỉ kiểm sàn `available > 0`.

## Migration

`1787803983000_add_text_extract_job` (expand-only, idempotent): thêm cột nullable `full_pipeline_job_id`, `processing_attempt` vào
`ai.processing_jobs` và unique index một hàng `TEXT_EXTRACT` mỗi Document. `job_type` không có CHECK nên không cần đổi ràng buộc. Go và
Node cũ không đọc cột mới và không claim hàng `TEXT_EXTRACT`.

## Rollout

Nest `worker` và `go-worker` là hai container trong cùng Deployment `worker` (`infra/k8s/apps.yaml.j2`, `strategy: Recreate`,
1 replica), nên bộ nhận event `DocumentExtractionCompleted` (Nest) và bộ claim `TEXT_EXTRACT` (Go) lên cùng một lần rollout. Node
`api` (nơi confirm ghi event `TEXT_EXTRACT`) là Deployment riêng: nếu `api` mới lên trước `worker` mới, hàng `TEXT_EXTRACT` chỉ chờ trong
hàng đợi (Document `PROCESSING`, chưa reserve) tới khi `worker` mới chạy; không mất dữ liệu. Job `FULL_PIPELINE` đã xếp hàng trước
rollout chạy như cũ (reserve cũ nếu có, settle no-op nếu không). Event `DocumentExtractionCompleted` bị Node cũ bỏ qua. Xác nhận sau
rollout: upload PDF với ví Free, thấy ledger `RESERVE` chỉ xuất hiện sau `DocumentExtractionCompleted`, rồi `SETTLE`/`RELEASE` như #273.

## Còn mở

Hiệu chỉnh hằng số bằng 3-5 file thật (đối chiếu hai log ở trên). Ví Free 10.000 vẫn thấp hơn chi phí thật 14.501: theo dõi ở #268.

## Giải thích thuật ngữ

- **Reserve** (giữ credit trước khi chạy); **settle** (chốt theo mức dùng thật);
  **release** (trả lại phần giữ thừa); **hold** (giữ lại khi chưa biết kết quả gọi provider).
- **Return seam** (đường trả kết quả từ Go về Node qua `ai.outbox`); **fence** (cờ
  chặn: attempt hoặc Document đã đổi thì không ghi kết quả); **CAS** (cập nhật có
  điều kiện trạng thái).
