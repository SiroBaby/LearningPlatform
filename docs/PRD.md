# PRD — AI Learning Platform (MVP-1: PDF/text baseline)

> **Trạng thái:** MVP-1 — PDF/text baseline; là capability đầu tiên trong MVP theo `docs/11-roadmaps.md`.
> **Nguồn sự thật kỹ thuật:** `docs/adr/*` (ADR thắng design doc khi mâu thuẫn — ADR-0009). PRD này là tầng *sản phẩm*: nó định nghĩa *xây gì & vì sao*, không định nghĩa *xây thế nào*.
> **Ngôn ngữ chung:** `CONTEXT.md` (glossary). Mọi thuật ngữ viết hoa (Document, Quiz, ProcessingJob...) dùng đúng nghĩa ở đó.
> **Mức chất lượng:** Capability chạy ở local/dev hoặc staging nhưng code phải production-grade trong phạm vi lát này. Hoàn thành PRD này không đồng nghĩa production launch; MVP còn cần Video/Audio/STT và OCR theo `docs/11-roadmaps.md`.

---

## 1. Tổng quan

**Một câu:** Biến tài liệu học của người dùng thành một gia sư AI biết kiểm tra hiểu bài — bắt đầu từ PDF/text, sinh quiz có chấm điểm, grounding vào đúng nguồn.

**Vấn đề.** Người học (sinh viên, người tự học VN) có hàng giờ tài liệu — PDF slide, giáo trình — nhưng học thụ động, không biết mình hiểu hay chưa cho tới lúc thi. Đọc xong một chương không có cách nào tự kiểm tra nhanh, đúng trọng tâm, bằng tiếng Việt.

**Giải pháp (MVP-1).** Upload PDF/text → hệ thống trích nội dung, sinh quiz trắc nghiệm có đáp án + giải thích (grounding vào nội dung gốc, có trích dẫn nguồn) → người học làm bài → được chấm điểm và xem mình đúng/sai từng câu.

**Vì sao chỉ PDF/text ở MVP-1.** USP dài hạn là *interactive video checkpoint*, nhưng walking skeleton cố tình bắt đầu từ PDF để dựng và kiểm chứng toàn bộ xương sống kiến trúc (upload → xử lý async → sinh AI → chấm) mà không bị rủi ro STT timestamp tiếng Việt che mờ tín hiệu. Video là nhánh kế tiếp, dùng lại ~80% pipeline này. (Lý do đầy đủ: grill Câu 3.)

**Bối cảnh dự án.** Đây là MVP hướng sản phẩm thật, triển khai theo lát capability: PDF/text baseline → Video/Audio/STT → OCR. MVP dùng modular monolith (NestJS) với AI Worker Golang và PostgreSQL durable queue; giữ 3 schema tách biệt (`course`/`ai`/`quiz`) cùng seam async nhưng không mở rộng service hay hạ tầng ngoài phạm vi capability.

---

## 2. Mục tiêu & Phi mục tiêu

**Mục tiêu MVP-1**

- M1 — Một người học upload được một PDF và nhận về quiz sinh tự động trong thời gian chấp nhận được.
- M2 — Quiz **grounded**: mỗi câu hỏi truy được về đoạn nguồn (citation), không bịa ngoài tài liệu.
- M3 — Người học làm bài và được **chấm điểm tất định** (MCQ), thấy đúng/sai + giải thích từng câu.
- M4 — Xương sống kiến trúc chạy đúng qua seam outbox/relay/job, PostgreSQL durable queue và AI Worker Golang, giữ ownership, idempotency và cache ngay trong MVP-1.
- M5 — Vòng lặp dev nhanh: chạy lại cùng một PDF gần như tức thì & miễn phí (GenerationCache).

**Phi mục tiêu MVP-1 (cố ý hoãn)**

- Video / Audio / STT — capability MVP-2, sau PDF/text baseline.
- OCR — capability MVP-3, sau Video/Audio/STT.
- Video Checkpoint, AI Tutor (RAG), OpenSearch, vector search — Post-MVP Improvement Backlog.
- Auth thật (register/login/JWT), RLS, Course, Learning Path, Chapter grouping — Post-MVP Improvement Backlog (MVP-1 dùng identity stub).
- Flashcard, Exam Simulator, Analytics/weak-topic — Post-MVP Improvement Backlog.
- Billing, thanh toán, top-up và model routing nâng cao — Post-MVP Improvement Backlog. Credit preflight cùng reserve-settle tối thiểu là cost-guard bắt buộc của luồng hiện hành. (GenerationCache KHÁC cost-guard — xem CONTEXT.md.)
- Anthropic native adapter và Local AI Connector — Post-MVP Improvement Backlog. Custom AI OpenAI-compatible cho mọi gói được đặc tả tại ADR-0021.
- Chấm fill-blank / essay (cần LLM rubric) — sub-slice sau.
- Kafka, Redis, Spring auth split, API Gateway, service split, KEDA/HPA/HA, GitOps, mesh và CQRS — Post-MVP Improvement Backlog.

> Nguyên tắc: MVP-1 làm **xuất sắc một lát mỏng khép kín**, không làm hời hợt nhiều tính năng.

---

## 3. Người dùng mục tiêu (MVP-1)

MVP-1 phục vụ **Persona 1 — "Minh, sinh viên IT"** (xem `docs/01`): upload slide/giáo trình PDF, muốn tự kiểm tra hiểu bài. Đây là persona duy nhất được tối ưu ở MVP-1.

Vì auth là stub (chưa có đăng nhập thật), MVP-1 chưa phục vụ "người dùng" theo nghĩa tài khoản — mà phục vụ **Owner** (chủ sở hữu Document, định danh qua header dev). Mọi dữ liệu scope theo `owner_id` ngay từ ngày 1 để ownership/IDOR enforcement không phải retrofit (ADR-0011, ADR-0018).

---

## 4. Phạm vi chức năng & Luồng người dùng

**Luồng end-to-end MVP-1:**

```
1. Owner chọn file và Platform Model hoặc Custom AI Configuration
2. Client gọi estimate để hiển thị credit hiện có, credit cần dùng và khả năng xử lý
3. Owner xin upload URL; browser upload thẳng lên MinIO bằng presigned multipart POST policy
4. Owner confirm → hệ thống verify file, reserve platform credit nếu cần, rồi đẩy việc xử lý (async)
5. [nền] pipeline: extract → chunk → sinh quiz (grounded + validated) → lưu
6. Owner theo dõi trạng thái Document (UPLOADED → PROCESSING → READY/FAILED)
7. Khi READY: Owner mở Quiz, làm bài
8. Owner nộp bài → chấm điểm (MCQ) → xem điểm + đúng/sai + giải thích từng câu
```

**Bước 1-2 (chọn nguồn xử lý và preflight):** Platform Model do operator quản lý và tiêu thụ platform credit; Custom AI Configuration thuộc Owner, phải `VERIFIED`, có ở cả Free và Paid, không tiêu thụ platform credit. Estimate trả `availableCredits`, `requiredCredits`, `shortfallCredits` và `canProcess`. Nếu biết chắc thiếu credit, giao diện chặn bắt đầu upload bằng Platform Model và đưa lựa chọn khắc phục. Preflight không reserve nên confirm vẫn phải kiểm tra lại để xử lý trường hợp balance thay đổi. (ADR-0021/0022.)

**Bước 3 (upload):** Client nhận `uploadUrl` và các `uploadFields` đã ký, tạo `multipart/form-data`, thêm toàn bộ signed fields trước field `file`, rồi `POST` trực tiếp tới MinIO. Policy ràng buộc exact object key, MIME type, kích thước khai báo và thời hạn; service không proxy file. Object key sinh ngẫu nhiên, không dùng tên file gốc làm path.

**Bước 4 (confirm):** Verify file thật nằm trên MinIO (tồn tại, size, magic bytes). Với Platform Model, kiểm tra và reserve credit có tính quyết định trước enqueue. Nếu thiếu, trả `402 INSUFFICIENT_CREDITS`, giữ Document ở `UPLOADED`, không tạo ProcessingJob; Owner có thể đổi model và confirm lại mà không upload lại. Nếu đủ, trong transaction chỉ-schema-`course`: reserve + CAS `documents.status UPLOADED→PROCESSING` + ghi `course.outbox`. Trả `202 Accepted`, không chạy pipeline trong request. Idempotent qua CAS. (ADR-0005, 0002, 0022.)

**Bước 5 (pipeline async):** Relay đọc `course.outbox` → gọi ingestion port của `ai` → tạo `ai.processing_jobs` → poller nhặt job → chạy extract → chunk → generate. Generation lặp per-chunk để phủ nội dung; mỗi câu hỏi qua validation (đúng-1 đáp án đúng, có citation tự chứa). Kết quả bàn giao per-document cho `assessment` dựng MỘT Quiz. (ADR-0012/0013/0014/0015/0019/0020.)

**Bước 6 (theo dõi và phục hồi):** `GET /documents/:id` trả `status` và lỗi nghiệp vụ an toàn. `FAILED` chỉ dùng khi pipeline đã bắt đầu rồi thất bại. Owner có thể chủ động retry lỗi có thể khắc phục, đổi model trước retry và không phải upload lại object hợp lệ. Mỗi retry tạo attempt mới, có rate limit và không automatic retry LLM. (ADR-0013/0022.)

**Bước 7-8 (làm bài + chấm):** Serve Quiz → nộp Attempt → chấm MCQ tất định (so option `is_correct`) → trả score + đúng/sai + explanation từng câu. API Quiz trả `409` khi chưa sẵn sàng hoặc processing đã thất bại, không trả `404` cho Quiz chưa được tạo; `404` chỉ dành cho Document không tồn tại/không thuộc Owner. (ADR-0022.)

**Loại nội dung MVP-1:** PDF (có text layer) + plain text. KHÔNG: PDF scan/OCR, DOCX/PPTX/XLSX, video, audio.
**Loại câu hỏi MVP-1:** MCQ single-select (đúng 1 đáp án). KHÔNG: fill-blank, essay, multi-select.

---

## 5. Success Metrics

MVP-1 là lát walking skeleton, nên metric chia hai nhóm: *sản phẩm* (quiz có dùng được không) và *kỹ thuật* (xương sống có đúng không).

**Metric sản phẩm**

| # | Metric | Mục tiêu MVP-1 |
|---|--------|------------------|
| P1 | Tỉ lệ câu hỏi qua validation (không bị drop) | ≥ 80% — drop quá nhiều = prompt tồi |
| P2 | Tỉ lệ câu hỏi grounded đúng (review tay khi tune) | định tính: "đáp án đúng & suy ra được từ nguồn" |
| P3 | Thời gian upload → quiz READY (PDF ~30 trang) | < 60s |
| P4 | Có thể làm trọn vòng upload → quiz → chấm điểm | Đạt/không |

**Metric kỹ thuật**

| # | Metric | Mục tiêu |
|---|--------|----------|
| T1 | confirm idempotent (gọi 2 lần không tạo 2 job) | Đạt |
| T2 | Re-run job sau crash không tạo quiz/câu trùng | Đạt (idempotency 3 tầng) |
| T3 | GenerationCache hit khi chạy lại cùng PDF + prompt | Đạt, ~0 cost lần 2 |
| T4 | Không có cross-schema query/transaction nào | Đạt (kiểm bằng review/log) |
| T5 | Mọi bảng nghiệp vụ có owner_id, mọi query lọc owner | Đạt |

> P1 (tỉ lệ drop) là **tín hiệu vàng để tune prompt** — theo dõi nó như một quality gate, không chỉ là số liệu (Câu 11).

---

## 6. Yêu cầu (Requirements)

**Functional**

- FR1 — Tạo presigned multipart POST policy cho PDF/text; response gồm `uploadUrl`, `uploadFields`, expiry; policy ràng buộc exact object key, MIME type và kích thước; object key ngẫu nhiên. *(đã có)*
- FR2 — confirm: verify MinIO (tồn tại + size + magic bytes) trước khi nhận.
- FR3 — Pipeline async: extract text từ PDF/text → chunk (giữ locator) → sinh quiz MCQ grounded.
- FR4 — Validation: mỗi Question đúng-1 đáp án đúng, ≥2 option, không trùng, có citation tự chứa + explanation; câu fail bị drop + log; có sàn tối thiểu số câu hợp lệ.
- FR5 — Lưu Quiz (một per document) + Questions; citation tự chứa `{chunkId, locator, snippet}`.
- FR6 — Theo dõi trạng thái Document qua API.
- FR7 — Serve Quiz; nhận Attempt; chấm MCQ tất định; trả điểm + đúng/sai + explanation từng câu.
- FR8 — Estimate phải trả preflight platform credit; confirm phải reserve trước enqueue và trả `402 INSUFFICIENT_CREDITS` mà không làm Document `FAILED` khi thiếu credit.
- FR9 — Owner có thể quản lý nhiều Custom AI Configuration OpenAI-compatible, xác minh trước khi dùng và chọn theo từng Document; quyền này có ở Free và Paid.
- FR10 — Owner có thể đổi model khi Document còn `UPLOADED` hoặc đủ điều kiện retry từ `FAILED`, rồi chủ động retry với attempt mới mà không upload lại object hợp lệ.
- FR11 — API Quiz phân biệt Document không tồn tại, Quiz chưa sẵn sàng, processing thất bại và vi phạm bất biến READY-không-có-Quiz bằng các HTTP status/error code riêng.

**Non-functional**

- NFR1 — Mọi việc >vài giây chạy async (202 + theo dõi), không block request.
- NFR2 — Idempotency 3 tầng tách biệt: job (document-scoped), cache (content-hash), persist quiz/question (xem CONTEXT.md).
- NFR3 — 3 schema tách biệt; no cross-schema query & transaction (ADR-0010).
- NFR4 — owner_id chảy theo data plane qua mọi seam async; worker nền không chế tạo danh tính (ADR-0018).
- NFR5 — Seam outbox/relay/ingestion port vận hành với PostgreSQL durable queue và AI Worker Golang trong MVP-1; Kafka là cải tiến sau MVP, không phải điều kiện thay thế hay completion gate.
- NFR6 — File upload an toàn: magic bytes, size cap, object key ngẫu nhiên (docs/07).
- NFR7 — `ai.chunks.text` là nguồn sự thật nội dung; chỉ cache output đã validate.

**Constraints**

- Stack MVP-1: NestJS modular monolith + AI Worker Golang + PostgreSQL durable queue + MinIO. Không thêm Kafka, Redis, OpenSearch hoặc hạ tầng mới.
- Inference: Platform Model do operator cấu hình qua environment/secret manager; Custom AI Configuration do Owner cá nhân cấu hình qua contract OpenAI-compatible và chỉ được dùng sau khi `VERIFIED`. Cả hai đi qua `LlmProvider` port; Local AI Connector và native provider adapter thuộc Post-MVP Improvement Backlog. (ADR-0004/0021.)
- Identity: stub qua `CurrentUser` seam (ADR-0011).

---

## 7. Rủi ro & Giả định

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| Chất lượng quiz (hallucination, đáp án sai) | **Cao (rủi ro #1)** | Grounding + citation + validation + chấm điểm phơi lỗi + theo dõi P1 |
| Prompt tune drift gây stale quiz | Trung bình | prompt_version = content-hash, tự bust cache + persist (ADR-0016) |
| Chi phí LLM khi tune lặp | Thấp (MVP-1) | GenerationCache (ADR-0003) |
| Seam async phức tạp hơn gọi thẳng | Trung bình | Cần cho PostgreSQL durable queue và AI Worker Golang của MVP-1; Kafka vẫn được hoãn sau MVP |
| Burn-out vì ôm nhiều thứ | **Cao** | Chỉ làm lát PDF→quiz; Video/Audio/STT và OCR theo capability kế tiếp, Kafka/K8s sau MVP |

**Giả định:** PDF MVP-1 có text layer (không OCR); một Owner (dev) là đủ để kiểm ownership bằng 2 stub user; LLM managed đủ tốt cho tiếng Việt ở mức quiz MCQ.

---

## 8. Tiêu chí hoàn thành MVP-1

MVP-1 xong khi:

1. Upload một PDF thật → nhận Quiz MCQ grounded, citation truy được về nguồn.
2. Làm bài → chấm điểm đúng → thấy đúng/sai + giải thích từng câu (trọn vòng, ADR Câu 10).
3. Tất cả metric kỹ thuật T1-T5 đạt.
4. P1 ≥ 80% trên một bộ PDF tiếng Việt mẫu; P3 < 60s.
5. Test pipeline chạy được offline qua `FakeLlmProvider`.
6. Review xác nhận: không cross-schema query/transaction; owner_id phủ mọi bảng + query.

Các tiêu chí này chỉ cho phép chuyển sang MVP-2 (Video/Audio/STT). Chúng không phải production launch approval. OCR là MVP-3; auth split, Gateway, search/RAG, hạ tầng scale và các production launch gate khác thuộc Post-MVP Improvement Backlog.

**Định nghĩa "sẵn sàng capability sau":** seam forward/return, PostgreSQL queue và Go worker hoạt động → MVP-2/MVP-3 chỉ thêm extractor phù hợp, không sửa `confirm`/luồng ghi hay ADR-0023.

---

## 9. Liên kết

- Quyết định kỹ thuật chi tiết: `docs/adr/0001`–`0022` (ADR là nguồn sự thật).
- Ngôn ngữ chung: `CONTEXT.md`.
- Thiết kế nền: `docs/00`–`docs/11`.
- Roadmap MVP: `docs/11-roadmaps.md`.

> **Phạm vi PRD này:** chỉ MVP-1. MVP-2 (Video/Audio/STT) và MVP-3 (OCR) có issue/PRD riêng ngay trước khi vào code; mọi hạng mục khác nằm trong Post-MVP Improvement Backlog.
