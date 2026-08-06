# Backend Rules — AI Learning Platform

## Scope And Source Of Truth

- Rules này chỉ áp dụng cho NestJS backend trong `app/`.
- `../CONTEXT.md` là ubiquitous language: dùng đúng `Document`, `Owner`, `Quiz`, `Question`, `ProcessingJob`, `JobStep`, `Citation`.
- `../docs/adr/*` thắng các design docs khi có mâu thuẫn.
- Backend đang ở Phase 0: PDF/text -> async processing -> grounded MCQ Quiz -> Attempt -> deterministic grading.

## Module And Layering

- Mỗi context nằm ở `src/modules/<context>/`, gồm controller, service, repository, entity và DTO.
- Domain enum đặt trong `src/modules/<context>/enums/`, không khai báo trong entity. Entity chỉ định nghĩa ORM mapping.
- Command, port và interface băng qua ranh giới module đặt trong `src/modules/<context>/contracts/`. Interface chỉ dùng nội bộ một lớp giữ cạnh lớp đó, không đưa vào `common/`.
- Controller chỉ nhận request DTO, lấy identity qua decorator/guard, gọi service, map raw result sang response DTO. Không business logic, không database access.
- Service sở hữu flow nghiệp vụ, authorization decision, orchestration và business exception. Không inject `Repository`, `DataSource`, `EntityManager`; không raw SQL hoặc query builder.
- Repository là lớp duy nhất truy cập PostgreSQL/TypeORM. Concrete repository phải extend `BaseRepository<T>` và nhận `DataSource` qua constructor.
- Repository chỉ chứa persistence/query/transaction; không chứa DTO, HTTP concern, response mapping hoặc business policy.
- Service không nhận DTO; controller chuyển DTO thành command/value raw. Response DTO không lộ `ownerId`, `storageRef`, khóa nội bộ hay dữ liệu nhạy cảm.
- Response mapping dùng AutoMapper (`@AutoMap()` + profile theo module). Controller gọi mapper; không dùng constructor/static mapper thủ công. Mapping khác tên, datetime hoặc dữ liệu cần che giấu phải khai báo tường minh trong profile.
- Nullable field trong response contract phải được map tường minh và có test xác nhận key vẫn tồn tại với giá trị `null`; không để AutoMapper biến `null` thành field bị omit.

## Database And Async

- Schema ownership: content/course -> `course`, AI processing -> `ai`, assessment -> `quiz`.
- Không cross-schema query hoặc transaction. Một transaction chỉ thay đổi schema mà module đó sở hữu.
- Mọi query resource-facing bắt buộc filter `owner_id`.
- `content -> ai`: `course.outbox` -> relay -> `AiIngestion`; content không ghi `ai.*`.
- `ai -> content`: dùng `ai.outbox` return seam; AI không ghi trực tiếp `course.documents`.
- Relay là at-least-once. Consumer/repository write phải idempotent.
- Return-relay payload validation must accept every value of its versioned domain error-code enum; add a FAILED relay test whenever a producer introduces a new code.
- Không tạo/sửa migration nếu không có yêu cầu rõ. Migration SQL thuần có cặp `.up.sql`/`.down.sql` trong `src/database/migrations/`.

## Validation, Time And API Contract

- Giữ global `ValidationPipe` với `whitelist`, `forbidNonWhitelisted`, `transform`.
- DTO dùng `class-validator`. String nghiệp vụ dùng `@IsNonBlankString()` thay vì chỉ `@IsString()`.
- Input datetime dùng `@IsUtcDateTime()`; controller không tự parse bằng `new Date()`.
- DTO datetime chỉ nhận ISO-8601 UTC có hậu tố `Z`; không nhận local time hoặc `+07:00` offset làm API contract.
- Thời điểm application tạo dùng `DateTimeUtil.nowUtc()`. Database chỉ dùng `timestamptz`/`now()` default; không dùng `timestamp without time zone` cho thời điểm nghiệp vụ.
- PostgreSQL connection session bắt buộc UTC (`-c timezone=UTC`). Backend không cộng/trừ `+07:00`.
- API và worker phải dùng cùng tracked SQL runner tại composition root trước khi tạo Nest application/context. Runner phải giữ `synchronize=false`, `migrationsRun=false`, lấy PostgreSQL advisory lock để serialize process khởi động đồng thời, áp pending tracked migration trước readiness, và fail-closed nếu migration không hoàn tất sạch.
- Response datetime dùng `DateTimeUtil.toUtcIsoString()` và luôn trả ISO-8601 UTC có hậu tố `Z`. Frontend tự format theo timezone của người dùng, ví dụ `Asia/Ho_Chi_Minh` (`UTC+7`).
- DTO request/response route-facing phải có Swagger decorators: `@ApiProperty` có description/example; controller có tag, operation và success/error response decorator.
- Chỉ `ApplicationConfigService` được inject `ConfigService` và chứa config path string. `main.ts`, storage service, database config và module khác dùng typed getter từ `ApplicationConfigService`.

## TypeScript Entity And Test Conventions

- Non-runtime TypeScript interfaces and external module shapes must use explicit Nest provider tokens/factories, with module-compilation coverage for the provider graph.
- Tên class, interface, type, function, method, biến, constant, provider token, file và module phải mô tả trách nhiệm nghiệp vụ hoặc kỹ thuật ổn định; không gắn tiền tố/hậu tố theo giai đoạn triển khai như `Phase0`, `Mvp`, `Temporary`, `New` hoặc `Legacy` nếu thành phần dự kiến tiếp tục tồn tại. Chỉ dùng tên mang tính tạm thời khi thành phần có kế hoạch loại bỏ rõ ràng; nếu trách nhiệm là lâu dài, chọn một tên thống nhất ngay từ đầu và dùng xuyên suốt mọi lớp.

- Với TypeORM entity được hydrate bởi ORM, mapped property bắt buộc dùng definite-assignment assertion (`property!: Type`) khi không được khởi tạo trong constructor; không dùng `?` hoặc giá trị mặc định giả chỉ để qua strict initialization.
- Test Jest phải import tường minh APIs từ `@jest/globals` (ví dụ `describe`, `it`, `expect`, `jest`) để editor type-check ổn định.
- Test dùng dependency ESM-only như `pdfjs-dist` phải chạy qua script `npm run test`/`npm run test:e2e` đã bật `node --experimental-vm-modules`; không gọi trực tiếp binary `jest` vì native dynamic import sẽ lỗi trong Jest VM.
- Migration test nhắm một version cụ thể không được giả định đó luôn là migration mới nhất; rollback theo version mục tiêu rồi chạy `runUp()` để test vẫn đúng khi có migration mới hơn.
- Trong `.spec.ts`, nếu VS Code không áp dụng legacy decorator configuration, đăng ký custom `PropertyDecorator` trực tiếp trên prototype (ví dụ `IsNonBlankString()(TestDto.prototype, 'value')`) thay vì decorator syntax. Test DTO vẫn phải dùng `value!: Type` cho property được gán trong test.

## Swagger Security

- Swagger mặc định tắt (`SWAGGER_ENABLED=false`).
- Chỉ bật Swagger khi đã đặt `SWAGGER_USERNAME` và `SWAGGER_PASSWORD`; nếu thiếu credentials, app phải fail-fast.
- Swagger UI dùng Basic Auth. Không expose OpenAPI raw JSON/YAML endpoint trừ khi có yêu cầu rõ và bảo vệ cùng cơ chế.
- Swagger mô tả identity stub Phase 0 qua `X-User-Id`; không mô tả bearer JWT trước Phase 3.

## Phase 0 Invariants

- Quiz thuộc đúng một Document; Course chỉ tham chiếu Document.
- `Document.status`: `UPLOADED -> PROCESSING -> READY/FAILED`.
- `ProcessingJob.status`: `PENDING -> RUNNING -> COMPLETED/FAILED`.
- Extract trả `ExtractedSegment { text, locator }`, không có taxonomy blocks.
- `ai.chunks.text` là nguồn sự thật. OpenSearch là index phái sinh ở Phase 5.
- Generate Quiz bằng grounding per-chunk, không retrieval/OpenSearch.
- Persist một Quiz per document/prompt-version, không quiz per chunk.
- Citation tự chứa `{ chunkId, locator, snippet }` để serve-side không query `ai.chunks`.
- Quiz serve projection phải tách khỏi grading projection và không được select/map `is_correct`, explanation hoặc citation trước khi Attempt được nộp.
- Document-scoped Quiz discovery phải xét `Document.status`: chỉ trả `404` khi Document không tồn tại/không thuộc Owner; dùng trạng thái riêng cho Quiz chưa sẵn sàng, processing thất bại và bất biến `READY` nhưng thiếu Quiz.
- Ordinal của Question trong một Quiz mới phải liên tục `0..N-1` sau validation/deduplication; khi đọc dữ liệu cũ có ordinal trùng, luôn dùng thêm khóa ổn định làm tie-breaker và không coi ordinal persisted là số hiển thị duy nhất cho người học.

## Verification

- Sau backend change, chạy `npm run build`.
- Chạy test hẹp nhất liên quan. Testcontainers cần Docker; nếu không có Docker, ghi rõ đây là blocker môi trường.
- Với route/shared symbol, chạy impact analysis trước edit.
- Trong môi trường development cục bộ, AI được chủ động chạy app, worker, build, test và thao tác dữ liệu/database phục vụ phát triển hoặc xác minh mà không cần xin phép trước, miễn là không tác động staging, production hay hạ tầng dùng chung.
- Phải hỏi trước khi thay đổi đáng kể cấu trúc dự án, tạo/sửa database schema hoặc migration, thực hiện thao tác database phá hủy/khó hoàn tác, hay có khả năng tác động staging, production hoặc tài nguyên dùng chung.
- Tất cả `dependencies` và `devDependencies` dùng exact version; `package.json` không được có prefix range `^`, `~`, `>`, `<`, `*` hoặc workspace range. Chỉ nâng version qua security/dependency upgrade có audit và verification.
- Sau mọi `npm install`, `npm uninstall` hoặc dependency upgrade: kiểm tra toàn bộ `package.json` để thay mọi range version bằng exact installed version, chạy `npm install --package-lock-only`, rồi chạy `npm audit`. Không kết thúc task khi package chưa được pin hoặc lockfile chưa đồng bộ.
- Không commit/push/pull khi chưa có yêu cầu rõ.

## Production Quality

- Object-storage bucket production phải được provision ngoài application. Startup chỉ kiểm tra quyền truy cập bucket và fail-fast; không tự tạo bucket hoặc yêu cầu `CreateBucket`.
- Trước khi gọi một flow là production-ready, phải xác minh end-to-end behavior, failure handling, bounded resource usage, graceful shutdown và configuration validation; không dựa vào happy path hoặc hard-code interval/batch/credential.
- Background processing phải chạy trong worker entrypoint/deployment role riêng, có typed configuration cho throughput/backoff, không overlap một worker loop, và không làm HTTP API process chạy worker ngầm.
- LLM provider và credentials chỉ được khởi tạo trong worker composition root; API process không giữ API key. Production worker phải fail-fast nếu provider thật hoặc credentials/model bị thiếu, và SDK logging phải tắt để không lộ source chunk/prompt.
- Entitlement, credit wallet và credit ledger thuộc schema `course`; schema `ai` chỉ giữ execution snapshot và provider usage. Không được gom billing transaction vào AI repository hoặc query chéo schema để tiện settlement.
- Provider dispatch phải có usage record idempotent trước call và cập nhật usage thật sau response. Khi dispatch không xác định được usage, giữ phần reservation chưa rõ bằng trạng thái hold; không được mặc định usage bằng 0 hoặc hoàn toàn bộ credit.
- Mọi worker write/finalize phải mang attempt fence đã claim, dùng budget + batch hữu hạn, và chỉ log mã/lời nhắn an toàn thay vì payload hoặc lỗi thô.
- Lỗi từ provider ngoài phải được phân loại tại adapter thành stable domain code trước khi qua worker/outbox; chỉ persist, relay và log code cùng safe message cố định, không để raw SDK/provider message rơi về `PROCESSING_FAILED` hoặc ra API.
- OpenAI worker capability phải là cặp typed coherent (`responses-json-v1`/`responses` hoặc `chat-completions-json-v1`/`chat-completions`); adapter chỉ bỏ duy nhất outer fence `\`\`\`json\\n...\\n\`\`\`` trước JSON parse và phân loại finish reason truncation thành stable retryable code.
- Tên model cấu hình như `gpt-5.4-mini` có thể là alias do AI gateway/provider ánh xạ sang model thực tế khác. Không coi tên model upstream trả về khác alias là contract mismatch nếu request qua alias vẫn đáp ứng capability, transport và structured-output contract đã cấu hình.
- Trước khi pin `OPENAI_STRUCTURED_OUTPUT_MODE` cho một gateway, phải probe đúng alias, transport và mode trên môi trường đích. Với `json-object`, prompt phải mô tả tường minh exact top-level shape và decoder vẫn phải từ chối key/shape khác; không tự fallback sang request thứ hai vì request đầu có thể đã phát sinh chi phí.
- Output-token cap của reasoning model phải tính cả token suy luận mà provider tính vào completion usage; chọn cap từ finish reason và usage đo trên đúng alias/transport, giữ cap trong shared generation parameters để provider request, budget reservation và cache fingerprint luôn đồng bộ, rồi xác minh lại bằng fresh runs thay vì thêm retry.
- Prompt sinh Quiz mặc định phải yêu cầu `stem`, nội dung lựa chọn và toàn bộ explanation bằng tiếng Việt kể cả khi chunk có nội dung tiếng Anh; chỉ giữ nguyên thuật ngữ tiếng Anh, viết tắt, tên riêng, product/API name và code identifier với đúng spelling/capitalization/punctuation từ nguồn, không chép nguyên câu tiếng Anh và không thêm claim, ví dụ hoặc suy luận ngoài Citation.
- Policy learner-facing mà LLM có thể bỏ qua không được chỉ dựa vào prompt: output mới phải qua deterministic validation trước cache/persist, và cache hit phải được validate lại trước khi sử dụng; không tự gọi provider lần hai để sửa output vi phạm.
- Source-aware language matcher phải giữ Unicode word token làm ranh giới; không được xóa từ tiếng Việt rồi so phần ASCII còn lại vì sẽ ghép các technical term rời rạc thành một English clause giả. Thay đổi matcher chỉ đủ điều kiện ship sau khi fresh mixed-language Document đạt `READY` và Quiz/Result được review trên environment đích.
- API/worker production log dùng JSON event có tên ổn định và metadata truy vết tối thiểu (`correlationId`, `cycleId`, `jobId`, status/duration khi phù hợp); development giữ format Nest có màu, level và context, đồng thời format event metadata trên một dòng dễ đọc. Polling cycle thành công hoặc không có việc phải im lặng; chỉ log startup/shutdown, công việc thật và failure/backoff. Không log request body, query string, source text, prompt, đáp án, credential, raw error message hoặc stack.
- Ưu tiên tái sử dụng module, port và repository hiện hữu; không duplicate orchestration hoặc tạo abstraction mới nếu composition root hiện có đủ. Source code theo runtime concern (`modules/`, `worker/`, `config/`); e2e test đặt ngoài `src/`.
