# Hàng đợi công việc bền PostgreSQL cho Phase 1

## Trạng thái

Đã được Owner phê duyệt cho GitHub Issue #20. Đây là quyết định contract và tài liệu; không thay đổi runtime, migration, hạ tầng hay cấu hình triển khai trong Issue này.

## Bối cảnh

Luồng hiện có đã có hai điểm bền nhưng chưa có contract hàng đợi đầy đủ. `course.outbox` lưu sự kiện forward trong cùng schema `course` tại `app/src/modules/content/entities/outbox-event.entity.ts`; `ForwardRelay` đọc các row chưa publish và gọi `AiIngestion` tại `app/src/modules/content/forward-relay.service.ts`. Phía `ai` tự tạo/upsert `ai.processing_jobs` qua `app/src/modules/ai/ai-ingestion.service.ts` và `app/src/modules/ai/repositories/processing-job.repository.ts`. `JobPoller` hiện claim một job rồi gọi processor tại `app/src/modules/ai/job-poller.service.ts`.

`ai.processing_jobs` đã giữ `document_id`, `owner_id`, `correlation_id`, trạng thái, attempt và idempotency key tại `app/src/modules/ai/entities/processing-job.entity.ts`. Tuy nhiên, nó chưa có lease, thời điểm retry, DLQ hay envelope versioned. `course.outbox` cũng hiện chưa có delivery contract tách biệt. Quyết định này chốt các hành vi đó trước khi có adapter runtime.

Các decision record hiện có liên quan là `docs/adr/0004-llm-provider-port-from-phase-0.md`, `docs/adr/0021-phase-5-custom-ai-byom-openai-compatible.md` và `docs/adr/0022-credit-preflight-processing-retry-and-quiz-state.md`.

## Quyết định

Phase 1 dùng PostgreSQL làm durable work queue (hàng đợi công việc bền) dựa trên `ai.processing_jobs`; `course.outbox` vẫn là transactional outbox (bảng phát sự kiện cùng transaction) cho handoff `course -> ai`. Một consumer logic duy nhất chạy vòng poll mỗi 1 giây, claim batch `1`; forward relay poll mỗi 1 giây với outbox batch `50`.

Go AI worker được phép có một ngoại lệ read-only (chỉ đọc) rất hẹp qua PostgreSQL role `ai_worker`: đọc đúng source descriptor của `course.documents` theo cặp `id` và `owner_id`, với các cột `id`, `owner_id`, `type`, `storage_ref`, `size_bytes`, và `status`. Descriptor này không được thêm vào envelope v1, không được sao chép thành projection lâu dài của `ai`, và không được log. Role này không có `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` hay quyền đọc `course.outbox` trên schema `course`.

Đây là ngoại lệ truy vấn chéo schema duy nhất của consumer. Tất cả mutation của course, gồm `course.documents`, trạng thái Document và budget thuộc course, vẫn chỉ do Node return relay thực hiện sau khi đọc `ai.outbox`. Go worker chỉ ghi vào schema `ai`; dưới attempt fence còn hiệu lực, nó persist side effect AI và một `ai.outbox` result trong cùng transaction rồi mới ACK/finalize delivery. Return relay vẫn at-least-once, nên projection course phải idempotent.

Mỗi claim có visibility lease (thời hạn độc quyền xử lý) `15 phút`. Lỗi kỹ thuật retry sau `5 giây`, `30 giây`, rồi `5 phút`, tối đa ba lần retry kỹ thuật; sau lần retry kỹ thuật cuối, job vào DLQ (dead-letter queue, vùng giữ việc không thể giao) và giữ `30 ngày`. Worker cycle bị lỗi trước khi claim hoặc lỗi hạ tầng toàn vòng chờ `5 giây` trước cycle kế tiếp.

Lỗi domain hoặc LLM đã được phân loại là final: không tự retry bằng chính job đó. Quyền Owner retry của `docs/adr/0022-credit-preflight-processing-retry-and-quiz-state.md` vẫn giữ nguyên; retry do Owner tạo attempt mới có attempt fence (khóa theo attempt), không hồi sinh delivery cũ.

Không đưa Kafka, RabbitMQ, Redis hay SQS vào Phase 1.

## Topology local và remote

```text
local hoặc remote deployment
course.documents + course.outbox
        |  relay: poll 1s, batch 50
        v
AiIngestion port
        v
ai.processing_jobs (nguồn replay bền)
        |  consumer: poll 1s, claim batch 1, lease 15m
        v
Go AI worker --read-only source descriptor--> course.documents
        |
        +-> ai writes đã fence + ai.outbox (một transaction) -> Node return relay -> course.documents
```

Topology local và remote giống nhau về PostgreSQL transaction, poll, lease, retry và contract. Khác biệt chỉ là endpoint PostgreSQL/deployment role; API process không chạy consumer ngầm. Credential provider chỉ được resolve trong worker theo `docs/adr/0004-llm-provider-port-from-phase-0.md`, không nằm trong message.

## Message envelope v1

Contract chuẩn là fixture `app/test/fixtures/contracts/document.processing.requested.v1.schema.json`. Envelope JSON có đúng các trường sau:

```json
{
  "schemaVersion": "1",
  "messageType": "document.processing.requested",
  "messageId": "UUID",
  "documentId": "UUID",
  "ownerId": "UUID",
  "job": {
    "jobId": "UUID",
    "jobType": "FULL_PIPELINE",
    "attempt": 1,
    "idempotencyKey": "sha256-hex-64",
    "leaseId": "UUID"
  },
  "correlationId": "UUID",
  "provider": {
    "selectionKind": "PLAN hoặc CUSTOM",
    "providerIdentity": "sha256-hex-64"
  },
  "prompt": {
    "version": "metadata-only",
    "fingerprint": "sha256-hex-64"
  },
  "occurredAt": "ISO-8601 UTC"
}
```

`providerIdentity` và `prompt.fingerprint` là hash; `prompt.version` chỉ là định danh metadata. Contract cấm tất cả field khác ở mọi object, vì vậy không có chỗ cho API key, ciphertext, URL provider, document/object/storage reference, extracted text, chunk, prompt hay câu trả lời LLM. Fixture không chứa ví dụ secret hoặc content.

## Delivery, ack và phục hồi

1. Relay chỉ đánh dấu row `course.outbox` đã publish sau khi ingestion idempotent thành công. Nếu process chết giữa hai bước, row chưa publish được replay; upsert của `AiIngestion` là điểm deduplicate.
2. Consumer chọn row đủ điều kiện bằng lock không chờ, atomically ghi `RUNNING`, tăng attempt, `lease_id` và `lease_until`. Chỉ một row được claim cho mỗi cycle.
3. Consumer phải mang `{ jobId, attempt, leaseId }` vào mọi write/finalize. Write hoặc ack có attempt/lease cũ trả no-op; không được ghi đè kết quả attempt mới hơn.
4. Ack thành công chỉ khi final state, output/outbox cùng schema và attempt fence được persist atomically. Ack không phải là chỉ xóa message trong memory.
5. Consumer crash trước ack hoặc sau persist nhưng trước ack làm lease hết hạn; durable row được replay. Duplicate delivery phải idempotent qua idempotency key và attempt fence. Consumer crash sau ack không được tạo delivery mới.
6. Lease hết hạn là stale delivery. Worker cũ không thể complete/fail hoặc publish kết quả khi `leaseId`/attempt không còn khớp.
7. Một retry kỹ thuật requeue cùng logical job với attempt mới theo schedule đã chốt. Final domain/LLM failure không requeue tự động; Owner retry tạo attempt mới theo policy hiện hữu.

## Nguồn replay, DLQ và failure matrix

`ai.processing_jobs` là nguồn replay bền cho processing work; không replay từ payload memory của relay. `course.outbox` chỉ là nguồn replay cho forward handoff `course -> ai`; `ai.outbox` hiện có tiếp tục là nguồn durable cho return seam. DLQ giữ message metadata v1, reason code an toàn, attempt cuối và thời điểm chuyển DLQ trong 30 ngày; không lưu source document, prompt hay secret.

| Tình huống | Hành vi Phase 1 | Kết quả |
| --- | --- | --- |
| Publish unavailable | Không mark `course.outbox.published_at`; relay thử lại cycle sau | Không mất việc, có thể duplicate ingest |
| Duplicate publish/delivery | Idempotency key + attempt fence | Một logical outcome |
| Consumer crash trước ack | Lease hết hạn, claim/replay | At-least-once |
| Consumer crash sau persist trước ack | Replay; finalize fenced/idempotent | Không ghi kết quả hai lần |
| Consumer crash sau ack | Không redelivery | Final outcome giữ bền |
| Technical transient failure | Requeue 5s/30s/5m, tối đa 3 retry | Sau đó DLQ 30d |
| Domain/LLM failure đã phân loại | Final, không automatic retry | Owner quyết định retry mới |
| Stale lease/message | Reject/no-op theo attempt + lease | Không ghi đè attempt mới |

## Alternatives đã loại

| Lựa chọn | Lý do loại ở Phase 1 |
| --- | --- |
| Kafka | Tăng vận hành và chưa cần throughput/consumer group đa dịch vụ; seam adapter được giữ cho Phase 2. |
| RabbitMQ | Thêm broker và semantics ack riêng khi PostgreSQL hiện đã là durability boundary. |
| Redis | Không phải nguồn durable mặc định cho yêu cầu replay/30-day DLQ này. |
| SQS | Thêm phụ thuộc cloud và vận hành ngoài topology PostgreSQL hiện có. |
| Chạy pipeline trong HTTP request | Mất async boundary, bounded retry/lease và recovery sau crash. |

## Kafka Phase 2 adapter seam

Phase 2 thay transport, không thay envelope v1 hay policy nghiệp vụ: producer Kafka thay forward relay publish path và Kafka consumer adapter thay PostgreSQL consumer adapter. Cả hai adapter nhận/trả `document.processing.requested` v1, cùng idempotency key, correlation ID, attempt fence, failure classification và Owner retry policy. `ai.processing_jobs` có thể giữ vai trò projection/audit hoặc được thay bằng persistence adapter đã migration rõ ràng; việc thay thế đó không thuộc Issue #20.

## Hệ quả

- Implementation sau này cần migration và repository contract cho lease, next-visible time, safe failure code và DLQ; Issue này cố ý không làm các thay đổi đó.
- At-least-once là contract chủ động, nên consumer/result write phải idempotent và fenced.
- Database role là backstop cho ownership: `ai_worker` chỉ được đọc source descriptor tối thiểu ở `course.documents`; không có Go write path nào vào `course`.
- Một consumer/batch nhỏ ưu tiên recovery rõ ràng hơn throughput ở Phase 1.
- Owner approval evidence: scope và các tham số định lượng trong GitHub Issue #20 đã được Owner phê duyệt trước khi tạo tài liệu này.
