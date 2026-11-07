# ADR-0033: Giữ credit PDF/TXT theo nội dung chữ thật sau bước extract

## Trạng thái

**Đề xuất, chờ Owner quyết định** (Issue #281). Tài liệu này sửa đổi phần
"reserve trong `confirmProcessing`/`retryProcessing`" của
[ADR-0022](0022-credit-preflight-processing-retry-and-quiz-state.md) chỉ cho
PDF/TXT dùng Platform Model. Chưa có code nào được viết theo ADR này.

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
| (b1) Job extract riêng, mẫu media | Job type mới `TEXT_EXTRACT`: Go extract + chunk, lưu chunk, phát `DocumentExtractionCompleted` về `ai.outbox`; Node reserve rồi forward `FULL_PIPELINE` | **Đề xuất.** Đúng kiến trúc (durable queue, return seam, fence), ví chỉ do Node ghi, không đổi quyền DB. Đổi lại thêm một job type và một event. |
| (b2) Một job, tạm dừng giữa chừng | `FULL_PIPELINE` extract xong thì chuyển trạng thái `AWAITING_RESERVATION`, Node reserve rồi resume | Loại: thêm trạng thái không claim được vào hàng đợi chung, cần event "resume" ngược Go, lease/stuck detector phải hiểu trạng thái mới. Phức tạp hơn b1. |
| (c) Go gọi API nội bộ của Node | Go gọi HTTP để reserve | Loại: đường đồng bộ ngoài hàng đợi bền, mất tính at-least-once/replay, thêm bề mặt xác thực service-to-service. |
| (h) Node tự extract khi confirm | Đọc PDF trong API process để đếm token | Loại: đưa parser PDF vào process API (CPU/RAM, DoS) và lặp lại logic đã nằm ở Go; trái hướng Owner đã chốt (extract ở worker). |

## Quyết định đề xuất: (b1)

Luồng:

1. `confirm`/`retry` (Platform Model, PDF/TXT): chỉ kiểm điều kiện tối thiểu
   `availableCredits > TEXT_MIN_AVAILABLE_CREDITS` (mặc định 0, cấu hình được), CAS
   Document sang `PROCESSING`, tăng `processing_attempt`, **không reserve**
   (`budget_status = NOT_RESERVED`), ghi outbox yêu cầu extract. Ví không vượt sàn
   thì vẫn `402 INSUFFICIENT_CREDITS` ngay (không chạy việc nặng cho ví rỗng).
   Custom AI không đổi (không reserve, không extract riêng).
2. Go (`TEXT_EXTRACT`): đọc object, `Extract`, `ChunkText`, lưu chunk, đếm ký tự/token
   chữ thật và số chunk, trong **một transaction có fence** (attempt + lease +
   chưa cancel) ghi `ai.outbox` `DocumentExtractionCompleted` (`documentId`, `ownerId`,
   `fullPipelineJobId`, `processingAttempt`, `deletionFence`, `extractedChars`,
   `chunkCount`). Lỗi extract giữ nguyên đường FAILED hiện tại (không đụng credit).
3. Node return relay -> `projection.completeExtraction` trong một transaction khóa
   Document trước, ví sau (như `confirmMediaProbe`): bỏ qua (`IGNORED`) nếu Document
   không còn `PROCESSING`, `deletionFence` hoặc `processing_attempt` khác (xóa giữa
   chừng thắng). Tính credit từ nội dung thật bằng hàm thuần (xem bên dưới) rồi
   `reserveCredits` với khóa `reserve:{fullPipelineJobId}:{processingAttempt}`:
   - `RESERVED`/`ALREADY_RESERVED`: ghi `estimated_credits`, `budget_status=RESERVED`,
     ghi `course.outbox` `DocumentReadyForProcessing`; forward relay tạo `FULL_PIPELINE`
     dùng chunk đã lưu (không extract lại).
   - `INSUFFICIENT`: Document `FAILED`, `errorCode = INSUFFICIENT_CREDITS_AFTER_EXTRACT`
     (retryable, nạp credit rồi Thử lại), không outbox, **không có `FULL_PIPELINE` nên
     không gọi provider**, ledger không có dòng nào.
4. Settlement không đổi: `settle|release|hold:{fullPipelineJobId}:{processingAttempt}`
   ở return seam (#273). #278: Document `DELETING` trước reserve thì không có gì để
   settle; sau reserve thì đường settle `DELETING` hiện có vẫn đúng vì khóa y hệt.

Công thức credit (hàm thuần ở Node, cần hiệu chỉnh bằng fixture; số hiện có chỉ là
một điểm dữ liệu: 14.501 thật cho `TÀI_LIỆU_DỰ_ÁN.pdf`):

```text
generationCredits = chunkCount * promptOverheadTokens * inputRate
                  + extractedTokens * inputRate
                  + chunkCount * outputTokensPerQuestion * outputRate
```

Vì Go gọi provider một lần mỗi chunk, công thức cũ (một lần `COARSE_OUTPUT_TOKEN_CAP`)
đang đếm thiếu phần output; phải đo lại, không suy ra từ một file.

## Idempotency, replay, retry, fence

- Replay `DocumentExtractionCompleted` (relay at-least-once): `reserveCredits` thấy
  `RESERVE` row, trả `ALREADY_RESERVED`; forward outbox chỉ ghi một lần theo khóa
  tự nhiên `(documentId, processingAttempt)`.
- Retry của Owner: attempt mới, extract lại, reserve khóa mới; attempt cũ đã FAILED
  không còn RESERVE mở (INSUFFICIENT không ghi gì, lỗi extract không reserve).
- Technical retry của Go (`attempts` tăng) không đổi khóa vì khóa dùng
  `processingAttempt` của Document.
- Xóa Document: deletion coordinator hủy job `TEXT_EXTRACT` như các job hiện có;
  event đến muộn bị fence `IGNORED`.

## Ước tính trước upload

Giữ số theo dung lượng nhưng chỉ là tham khảo: nhãn "ước tính sơ bộ", `precision`
`COARSE` không còn là mức giữ. **Quan trọng:** `canProcess`/chặn upload của ADR-0022
hiện dựa trên số coarse này; nếu không đổi thì UI vẫn chặn ví Free dù Node không còn
giữ theo số đó. Phải đổi `canProcess` cho PDF/TXT thành `available > sàn`, và web
không chặn cứng theo `shortfallCredits` của số coarse.

## Migration

Dự kiến expand-only, idempotent: (1) cho phép `job_type = 'TEXT_EXTRACT'` nếu có
ràng buộc (chưa tìm thấy CHECK trên `ai.processing_jobs.job_type`, cần xác nhận
trên DB thật), (2) có thể thêm cột nullable `extracted_chars`/`chunk_count` cho
audit. Worker/Node cũ phải chạy được trong rollout (expand/contract); contract
envelope mới cần version hoặc job type mới để Go cũ không claim nhầm.

## Cần Owner quyết định trước khi code

1. Chấp nhận thêm job type `TEXT_EXTRACT` (b1) thay vì giữ một job (b2)?
2. Có chấp nhận migration expand-only nêu trên không (AGENTS cấm tự tạo migration)?
3. Sàn tối thiểu mặc định `0` hay một số nhỏ (ví dụ 100 credit)?
4. Mã lỗi `INSUFFICIENT_CREDITS_AFTER_EXTRACT` và copy tiếng Việt UI.
5. Có cần dữ liệu hiệu chỉnh công thức từ nhiều file thật (PDF/TXT) trước khi chốt
   hằng số `promptOverheadTokens`, `outputTokensPerQuestion`?
6. Ví Free 10.000 vẫn thấp hơn chi phí thật 14.501: tiếp tục theo dõi ở #268.

## Giải thích thuật ngữ

- **Reserve** (giữ credit trước khi chạy); **settle** (chốt theo mức dùng thật);
  **release** (trả lại phần giữ thừa); **hold** (giữ lại khi chưa biết kết quả gọi provider).
- **Return seam** (đường trả kết quả từ Go về Node qua `ai.outbox`); **fence** (cờ
  chặn: attempt hoặc Document đã đổi thì không ghi kết quả); **CAS** (cập nhật có
  điều kiện trạng thái).
