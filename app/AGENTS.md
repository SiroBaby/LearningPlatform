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

## Database And Async

- Schema ownership: content/course -> `course`, AI processing -> `ai`, assessment -> `quiz`.
- Không cross-schema query hoặc transaction. Một transaction chỉ thay đổi schema mà module đó sở hữu.
- Mọi query resource-facing bắt buộc filter `owner_id`.
- `content -> ai`: `course.outbox` -> relay -> `AiIngestion`; content không ghi `ai.*`.
- `ai -> content`: dùng `ai.outbox` return seam; AI không ghi trực tiếp `course.documents`.
- Relay là at-least-once. Consumer/repository write phải idempotent.
- Không tạo/sửa migration nếu không có yêu cầu rõ. Migration SQL thuần có cặp `.up.sql`/`.down.sql` trong `src/database/migrations/`.

## Validation, Time And API Contract

- Giữ global `ValidationPipe` với `whitelist`, `forbidNonWhitelisted`, `transform`.
- DTO dùng `class-validator`. String nghiệp vụ dùng `@IsNonBlankString()` thay vì chỉ `@IsString()`.
- Input datetime dùng `@IsUtcDateTime()`; controller không tự parse bằng `new Date()`.
- DTO datetime chỉ nhận ISO-8601 UTC có hậu tố `Z`; không nhận local time hoặc `+07:00` offset làm API contract.
- Thời điểm application tạo dùng `DateTimeUtil.nowUtc()`. Database chỉ dùng `timestamptz`/`now()` default; không dùng `timestamp without time zone` cho thời điểm nghiệp vụ.
- PostgreSQL connection session bắt buộc UTC (`-c timezone=UTC`). Backend không cộng/trừ `+07:00`.
- Response datetime dùng `DateTimeUtil.toUtcIsoString()` và luôn trả ISO-8601 UTC có hậu tố `Z`. Frontend tự format theo timezone của người dùng, ví dụ `Asia/Ho_Chi_Minh` (`UTC+7`).
- DTO request/response route-facing phải có Swagger decorators: `@ApiProperty` có description/example; controller có tag, operation và success/error response decorator.
- Chỉ `ApplicationConfigService` được inject `ConfigService` và chứa config path string. `main.ts`, storage service, database config và module khác dùng typed getter từ `ApplicationConfigService`.

## TypeScript Entity And Test Conventions

- Với TypeORM entity được hydrate bởi ORM, mapped property bắt buộc dùng definite-assignment assertion (`property!: Type`) khi không được khởi tạo trong constructor; không dùng `?` hoặc giá trị mặc định giả chỉ để qua strict initialization.
- Test Jest phải import tường minh APIs từ `@jest/globals` (ví dụ `describe`, `it`, `expect`, `jest`) để editor type-check ổn định.
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

## Verification

- Sau backend change, chạy `npm run build`.
- Chạy test hẹp nhất liên quan. Testcontainers cần Docker; nếu không có Docker, ghi rõ đây là blocker môi trường.
- Với route/shared symbol, chạy impact analysis trước edit.
- Tất cả `dependencies` và `devDependencies` dùng exact version; `package.json` không được có prefix range `^`, `~`, `>`, `<`, `*` hoặc workspace range. Chỉ nâng version qua security/dependency upgrade có audit và verification.
- Sau mọi `npm install`, `npm uninstall` hoặc dependency upgrade: kiểm tra toàn bộ `package.json` để thay mọi range version bằng exact installed version, chạy `npm install --package-lock-only`, rồi chạy `npm audit`. Không kết thúc task khi package chưa được pin hoặc lockfile chưa đồng bộ.
- Không commit/push/pull khi chưa có yêu cầu rõ.

## Production Quality

- Trước khi gọi một flow là production-ready, phải xác minh end-to-end behavior, failure handling, bounded resource usage, graceful shutdown và configuration validation; không dựa vào happy path hoặc hard-code interval/batch/credential.
- Background processing phải chạy trong worker entrypoint/deployment role riêng, có typed configuration cho throughput/backoff, không overlap một worker loop, và không làm HTTP API process chạy worker ngầm.
- Ưu tiên tái sử dụng module, port và repository hiện hữu; không duplicate orchestration hoặc tạo abstraction mới nếu composition root hiện có đủ. Source code theo runtime concern (`modules/`, `worker/`, `config/`); e2e test đặt ngoài `src/`.
