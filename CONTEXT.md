# AI Learning Platform — Context

Nền tảng biến tài liệu học (video, PDF, audio...) thành trải nghiệm học tương tác bằng AI. Glossary này chốt ngôn ngữ chung (ubiquitous language) của dự án; chỉ định nghĩa khái niệm, không chứa chi tiết triển khai.

## Language

**Document**:
Một tài liệu học do người dùng upload (PDF, video, audio, ...). Là đơn vị sở hữu của mọi nội dung AI sinh ra từ nó (quiz, checkpoint, chapter, flashcard).
_Avoid_: File, Asset, Material

**Owner**:
Chủ sở hữu một **Document** và mọi thứ phái sinh — ở B2C đây chính là tenant. Mọi bảng nghiệp vụ mang `owner_id` từ ngày đầu; mọi query lọc theo owner (chống IDOR). Ở Phase 0 danh tính là stub qua header (CurrentUser seam), chưa phải JWT.
_Avoid_: User (User là khái niệm Auth/Identity ở Phase 3; Owner là vai trò sở hữu tài nguyên), Account

**Course**:
Một tầng nhóm gộp nhiều **Document** thành một lộ trình học. Không bao giờ là chủ sở hữu của quiz/checkpoint — chỉ tham chiếu tới các Document. Xuất hiện từ Phase 4.
_Avoid_: Class, Lesson, Path

**Quiz**:
Tập câu hỏi do AI sinh, được grounding vào nội dung của đúng một **Document**.
_Avoid_: Test, Assessment (Assessment là tên context, không phải khái niệm này)

**Question**:
Một câu hỏi trong **Quiz**, là aggregate tự enforce bất biến lúc tạo. Bất biến MCQ single-select: **đúng 1** đáp án đúng, ≥2 option, không trùng câu, có citation + explanation. Việc enforce này CHÍNH LÀ "validation layer" — không phải hai thứ tách rời.
_Avoid_: Item, Problem

**VideoCheckpoint**:
Điểm dừng (pause) trong một **Document** dạng video, kèm câu hỏi về phần vừa xem.
_Avoid_: Marker, Pause point

**ProcessingJob**:
Đơn vị công việc bất đồng bộ biến một **Document** đã upload thành nội dung học (chạy pipeline extract → STT → chunk → embed → generate). Một Document sinh ra một hoặc nhiều ProcessingJob.
_Avoid_: Task, Pipeline (Pipeline là chuỗi bước bên trong một Job, không phải bản thân Job)

**JobStep**:
Một bước trong pipeline của một **ProcessingJob** (EXTRACT, TRANSCRIBE, CHUNK, EMBED, GENERATE). Là chi tiết vận hành, không phải trạng thái của Document.
_Avoid_: Stage, Phase

**Document.status** (vòng đời người dùng):
`UPLOADED → PROCESSING → READY / FAILED`. Là projection của trạng thái Job — trả lời "tài liệu của tôi tới đâu rồi", không lộ chi tiết bước.

**ProcessingJob.status** (vòng đời thực thi):
`PENDING → RUNNING → COMPLETED / FAILED`. Trả lời "việc chạy tới đâu" — chi tiết bước nằm ở **JobStep**.

**GenerationCache**:
Bộ nhớ đệm kết quả LLM theo key = hash(input chuẩn hóa + nội dung prompt template + provider identity + params). Tự bust khi prompt template, endpoint/model capability hoặc generation params đổi. Mục đích chính ở Phase 0 là cứu vòng lặp dev (chạy lại cùng tài liệu nhiều lần), không phải tối ưu chi phí production.
_Avoid_: Cost-guard (xem dưới — đây là hai khái niệm khác nhau)

**Cost-guard**:
Lớp bảo vệ chi phí production gồm quota, billing/credit reserve-settle, model routing, circuit breaker. Credit preflight và reserve-settle tối thiểu xuất hiện ngay khi Platform Model dùng credit; billing, top-up và routing nâng cao được hoàn thiện ở Phase 4. KHÔNG bao gồm GenerationCache.
_Avoid_: Cache (cache là tối ưu dev-loop, cost-guard là kiểm soát chi tiêu production)

**Custom AI / BYOM**:
Năng lực dành cho mọi Owner, không phụ thuộc gói Free hay trả phí, cho phép dùng model qua endpoint OpenAI-compatible do Owner cấu hình. Chi phí inference thuộc quan hệ giữa Owner và provider của họ, không tiêu thụ platform credit. Bao gồm provider/proxy bên thứ ba và runtime tự host mà worker có thể truy cập an toàn.
_Avoid_: Model routing (routing của nền tảng tự chọn model; BYOM là user chọn credential/endpoint), Local Model (chỉ là một kiểu endpoint)

**Custom AI Configuration**:
Cấu hình Custom AI thuộc đúng một Owner, gồm tên hiển thị, base URL, model và secret API key tùy chọn. Một Owner có thể có nhiều cấu hình và chọn một cấu hình cụ thể cho từng Document. Chỉ cấu hình đã xác minh mới được dùng để xử lý.
_Avoid_: Platform Model, Shared Model, User-global Active Model

**Platform Model**:
Model do operator của nền tảng cấu hình và vận hành cho các gói subscription. Việc sử dụng Platform Model tiêu thụ platform credit theo cơ chế reserve-settle; model này không do Admin hoặc Owner tạo trong giao diện.
_Avoid_: Custom AI, Admin Model

**Credit preflight**:
Ước lượng trước khi upload để Owner biết số platform credit hiện có, số cần dùng và phần còn thiếu. Đây là thông tin hỗ trợ quyết định, không thay thế lần kiểm tra và reserve có tính quyết định tại lúc confirm.
_Avoid_: Credit reservation, Billing settlement

**Processing attempt**:
Một lần thực thi ProcessingJob có attempt fence, lựa chọn model và vòng đời reserve-settle độc lập. Retry tạo attempt mới; không ghi đè lịch sử của attempt cũ.
_Avoid_: Upload lại, Automatic LLM retry

**Local AI Connector**:
Agent chạy trên máy/mạng của người dùng, tạo kết nối outbound đã xác thực để SaaS worker sử dụng local model mà không giả định server có thể gọi `localhost` của người dùng. Self-hosted deployment có thể gọi endpoint local/private trực tiếp theo egress policy riêng.
_Avoid_: Gọi `localhost` trực tiếp từ SaaS backend, tunnel công khai không kiểm soát

**Provider identity**:
Dấu vân tay không chứa secret của provider/model: hash từ provider type + canonical base URL + model + transport + structured-output mode + capability version. GenerationCache, prompt audit và persist dedup dùng identity này thay cho tên model trần; API key không được đưa vào hash hoặc log. Platform Model resolve từ cấu hình operator-managed; Custom AI resolve theo Owner và Custom AI Configuration đã chọn.
_Avoid_: Model name đơn lẻ, API-key hash

**ExtractedSegment**:
Đơn vị đầu ra của bước Extract: `{ text, locator }`. Là format trung gian chung cho mọi loại nguồn (PDF, video transcript) để downstream không cần biết nguồn gốc. KHÔNG mang taxonomy heading/paragraph/table.
_Avoid_: Block (tên cũ ở docs/05), Chunk (Chunk là đơn vị sau khi cắt để embedding, khác ExtractedSegment), Chapter

**Locator**:
Vị trí của một **ExtractedSegment** trong nguồn, dạng tagged union: `{kind:'page', page}` cho PDF, `{kind:'time', startSec, endSec}` cho video/audio. Là nền của citation.
_Avoid_: Position, Offset

**Grounding**:
Thuộc tính lúc-SINH: ép LLM chỉ tạo câu hỏi từ đúng đoạn nguồn được đưa vào prompt. Là prompt discipline, có ngay Phase 0, KHÔNG cần search.
_Avoid_: Retrieval (khác hẳn — xem dưới)

**Retrieval**:
Thuộc tính lúc-ĐỌC: tìm đoạn nội dung liên quan trong nhiều nghìn chunk (vector/BM25 qua OpenSearch). Phục vụ read-side (Tutor), thêm ở Phase 5.
_Avoid_: Grounding, Search (nói chung)

**Citation**:
Tham chiếu nguồn của một câu hỏi/câu trả lời, trỏ vào **`ai.chunks.id`** (nguồn sự thật, có từ Phase 0) + **Locator**. KHÔNG trỏ `os_doc_id` (index phái sinh, Phase 5).
_Avoid_: Reference, Source link

**Attempt**:
Một lần người dùng làm một **Quiz**: tập câu trả lời đã nộp + kết quả chấm. Một Quiz có nhiều Attempt.
_Avoid_: Submission, Try

**Grading**:
Việc chấm một **Attempt**. Phase 0 chỉ auto-grade MCQ (so đáp án đúng, tất định, không cần LLM); essay/rubric (cần LLM) để sub-slice sau.
_Avoid_: Scoring, Marking

## Relationships

- A **Quiz** belongs to exactly one **Document** — vĩnh viễn.
- A **VideoCheckpoint** belongs to exactly one **Document** (video).
- A **Course** groups one or more **Document**s by reference only; it never owns a **Quiz** or **VideoCheckpoint**.
- A **Document** has one or more **ProcessingJob**s; each ProcessingJob processes exactly one Document.
- An **Attempt** belongs to exactly one **Quiz**; a Quiz has zero or more Attempts.

## Example dialogue

> **Dev:** "Khi gom nhiều Document vào một Course, quiz có chuyển sở hữu sang Course không?"
> **Domain expert:** "Không. Quiz luôn thuộc về Document gốc của nó. Course chỉ là cách sắp xếp các Document lại với nhau để học — nó tham chiếu, không sở hữu."

## Seam & async vocabulary (ADR 0012–0020)

**Outbox**:
Bảng trong schema của bên PHÁT (`course.outbox`, `ai.outbox`) — ghi cùng TX với thay đổi domain (same-schema, giữ ADR-0010) để không mất việc (chống dual-write). Mỗi producing schema có outbox riêng.
_Avoid_: Queue (queue là nơi tiêu thụ; outbox là nơi phát ghi giao dịch)

**Relay**:
Bước "publish" đọc một **Outbox** rồi giao sang nơi khác bằng hai TX tách rời + thao tác idempotent (at-least-once). KHÔNG phải giao dịch domain, KHÔNG cross-schema-TX.
_Avoid_: Job (Relay vận chuyển; ProcessingJob là công việc)

**Forward seam** (content→ai): `course.outbox` → relay → **Ingestion port** của ai → `ai.processing_jobs`.
**Return seam** (ai→content): `ai.outbox` → relay → module content cập nhật `course.documents.status`. Đối xứng forward seam; là cách Document.status được projection mà không ghi cross-schema.

**Ingestion port**:
Cổng do module `ai` sở hữu (`AiIngestion.enqueue(...)`) để relay giao việc — `ai` tự ghi `ai.processing_jobs`. Không module nào ghi thẳng schema module khác (ADR-0010/0019). Phase 2: port → consumer Kafka.
_Avoid_: Repository (relay không chạm repository/SQL của ai)

**Handoff DTO** (ai→assessment):
Gói bàn giao cấp-DOCUMENT (không per-chunk) sau khi pipeline xong: mang mảng câu hỏi + citation tự chứa (snippet+locator denormalized, ADR-0015) + `owner_id`. assessment dựng MỘT Quiz, append câu hỏi. Phase 2 → event `QuizGenerated`.

**Owner propagation**:
`owner_id` chảy theo DATA qua mọi seam async (outbox payload → job → handoff → quiz). Worker nền KHÔNG có CurrentUser, không bịa danh tính — chỉ đọc owner_id từ data. Identity vào hệ thống đúng một lần ở rìa (`confirm`), rồi đông cứng thành dữ liệu (ADR-0018).

**prompt_version**:
KHÔNG phải chuỗi gõ tay mà là **content-hash của prompt template** (+provider identity+params). Một dấu vân phục vụ cả: bust GenerationCache, dedup persist quiz `hash(document_id+prompt_version)`, audit. Sửa prompt hoặc đổi endpoint/model capability → hash đổi → cả ba đồng bộ (ADR-0016/0021).
_Avoid_: Version string thủ công (gây stale-quiz footgun)

**Ba khóa idempotency — đừng gộp**:
(1) `processing_jobs.idempotency_key = hash(document_id+job_type)` — "document này đã bắt đầu xử lý chưa" (ADR-0005). (2) `generation_cache.cache_key = hash(input+prompt_template+provider_identity+params)` — "lệnh LLM này trên đúng provider/model capability đã có kết quả chưa" (ADR-0003/0021). (3) quiz persist `hash(document_id+prompt_version)` + question `hash(quiz_id+chunk_id+ordinal)` — "đã bàn giao quiz/câu này chưa" (ADR-0014/0020).

## Relationships (async seams)

- **Generation** chạy per-chunk (phủ nội dung); **handoff/persist** chạy per-document (Quiz là container persist một lần). Hai granularity khác tầng — không dùng chung key (ADR-0020).
- `ai.chunks.text` là **nguồn sự thật** của nội dung chunk từ Phase 0; OpenSearch (Phase 5) là index phái sinh, rebuild được (ADR-0017).
- **Citation** tự chứa: `{chunkId, locator, snippet}` — `chunkId` để truy nguyên, `locator`+`snippet` nhúng sẵn để hiển thị không cần đọc `ai.chunks` cross-schema (ADR-0015).

## Flagged ambiguities

- `docs/02`/`docs/06` gọi event lúc confirm là `DocumentUploaded`; ADR-0005 ghi `DocumentReadyForProcessing`. Resolved: dùng **`DocumentReadyForProcessing`** — upload lên MinIO đã xong từ trước (luồng 3 bước presign→upload→confirm), event tại confirm là "đã verify, sẵn sàng xử lý", không phải "vừa upload".
- ADR-0012 viết "relay ghi `ai.processing_jobs`" nhưng ADR-0010 cấm ghi thẳng schema module khác — resolved ở ADR-0019: relay gọi **ingestion port** của ai, ai tự ghi schema mình.
- Naive "for each chunk → persist quiz" làm chunk 2 đụng dedup key của chunk 1 → mất câu hỏi → vỡ coverage. Resolved: tách generation (per-chunk) khỏi persist (per-document), ADR-0020.
- "Course" ban đầu dễ bị hiểu là chủ sở hữu nội dung — resolved: Course chỉ là tầng nhóm gộp tham chiếu, Document mới là chủ sở hữu quiz/checkpoint.
- "segment" trong `docs/05` dùng cho **chapter segmentation** (chia chương); ở đây **ExtractedSegment** là đơn vị output của bước Extract — hai khái niệm khác nhau, đừng lẫn.
- `docs/05` mô tả output Extract là `blocks[]` có taxonomy `{type: heading/paragraph/table}` — ta cố tình lệch: dùng `ExtractedSegment {text, locator}` KHÔNG taxonomy. Taxonomy để dành cho chapter segmentation (Phase sau), không phải bước Extract.
- `docs/05` trình bày grounding và retrieval cạnh nhau trong bối cảnh RAG, dễ hiểu nhầm quiz generation cần OpenSearch — resolved: **Grounding** (write-side, Phase 0) tách hẳn **Retrieval** (read-side/Tutor, Phase 5). Sinh quiz chỉ cần grounding.
- "validation layer" (`docs/05` mục 7) và "aggregate invariant" (`docs/02` mục 5) là **cùng một thứ** — Question aggregate tự enforce bất biến lúc tạo, không phải hai tầng tách rời.
- `docs/02` ghi Question có "**≥1** đáp án đúng"; `docs/05` ghi "**đúng 1**" — mâu thuẫn. Resolved: MCQ single-select **đúng 1** (vì hợp đồng grader Câu 10 cần thế). Multi-select là loại câu khác, không thuộc Phase 0.
