# Kế hoạch contract test: `document.processing.requested` v1

Fixture chuẩn: `app/test/fixtures/contracts/document.processing.requested.v1.schema.json`.

Hiện chưa có durable-queue adapter phát/nhận envelope v1, nên đây là danh sách test Jest thực thi khi adapter được triển khai; không phải kết quả runtime đã chạy. Test đặt cạnh adapter tương lai trong `app/src/modules/ai/` và import tường minh từ `@jest/globals`, theo convention của các file `*.spec.ts` hiện có như `app/src/modules/ai/job-poller.spec.ts` và `app/src/modules/content/forward-relay.spec.ts`.

| Case | Arrange/Act/Assert bắt buộc |
| --- | --- |
| Valid v1 | Serialize envelope metadata-only hợp lệ; schema accept và consumer nhận đúng UUID, attempt `>= 1`, provider/prompt hash. |
| Invalid | Thiếu từng required field, UUID sai, `attempt: 0`, hash sai, extra property lồng trong `job`/`provider`/`prompt`, hoặc `apiKey`/`documentContent`/`promptContent`; schema reject. |
| Stale | Giao attempt hoặc lease đã hết hạn sau claim mới; consumer không process/finalize và không publish return event. |
| Unsupported version | `schemaVersion` khác `1` hoặc `messageType` khác; producer/consumer fail closed với safe code, không enqueue/ack. |
| Publish unavailable | Ingestion/publish lỗi trước mark published; `course.outbox.published_at` vẫn `NULL`, cycle sau có thể replay, upsert vẫn idempotent. |
| Technical retry schedule | Với lỗi technical có thể retry, fake clock/scheduler phải quan sát đúng ba lần retry sau initial attempt tại `5s`, `30s`, `5m`; sau retry thứ ba không schedule lần thứ tư (tối đa bốn attempt tổng). Với domain error hoặc LLM error, assert không tạo retry schedule và không gọi lại handler tự động. |
| DLQ transition and retention | Exhaust technical retry budget; message chuyển đúng một lần vào DLQ với `jobId`, attempt và reason/code đã sanitize, không chứa `apiKey`, `documentContent`, `promptContent` hoặc raw error/payload nhạy cảm. Assert retention của bản ghi DLQ là 30 ngày và cleanup chỉ được phép sau mốc 30 ngày. |
| Duplicate delivery | Giao cùng `jobId`/attempt/lease hai lần, gồm cả delivery lặp sau retry; finalize/outbox chỉ có một logical outcome, không nhân đôi content confirmation, ownership/schema write hoặc user-visible result. |
| Worker crash trước ack/terminal commit | Mô phỏng worker crash sau claim nhưng trước persisted ack và trước final write/outbox commit; lease hết hạn, claim mới được giao lại, và chỉ delivery kế tiếp mới tạo một terminal outcome. |
| Worker crash sau terminal commit trước ack | Mô phỏng final write/outbox commit thành công rồi worker crash trước ack; replay bị fence/idempotency chặn, không nhân đôi result, content confirmation, ownership/schema write hoặc user-visible result. |
| Worker crash sau ack | Ack và terminal state đã commit; poll sau không giao lại message. |
| Kafka Phase 2 adapter conformance | Khi Kafka adapter được thêm ở Phase 2, chạy cùng fixture v1 qua Kafka producer/consumer và assert envelope schema/metadata có cùng contract như durable queue. Adapter không được sửa Content confirm, ownership/schema writes hoặc user-visible behavior; chỉ kiểm transport conformance, không thay đổi semantics của v1. |

Các case cần PostgreSQL transaction/lease thật dùng Testcontainers theo pattern `startTestDb` trong `app/src/modules/ai/job-poller.spec.ts`; schema-only valid/invalid test không cần database. Kafka Phase 2 adapter test cũng là future runtime adapter test. Không chạy các test runtime adapter này trong Issue #20 vì adapter, migration lease/DLQ và test implementation chưa tồn tại.
