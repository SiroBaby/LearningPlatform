# AI Learning Platform — Bản Thiết Kế Hệ Thống

> Tài liệu kiến trúc cho nền tảng biến mọi tài liệu học tập thành trải nghiệm học tập tương tác bằng AI.
> Phục vụ thị trường **Việt Nam / SEA**, khách hàng **B2C** (học sinh, sinh viên, người tự học). Platform Model dùng managed inference; Custom AI/BYOM qua endpoint OpenAI-compatible được mở cho mọi gói khi identity, secret-management, admin feature setting và egress boundary sẵn sàng theo ADR-0021. Local AI Connector để phase sau.

---

## 0. Cách đọc tài liệu này

Bộ tài liệu được chia thành các phần, mỗi phần một file. Đọc theo thứ tự để hiểu từ "tại sao" đến "làm thế nào":

| # | File | Nội dung | Vai trò viết |
|---|------|----------|--------------|
| 00 | `00-README.md` | Tổng quan, định vị, bản đồ đọc | CTO |
| 00 | `00-executive-summary.md` | Quyết định kiến trúc, learning roadmap, over-engineering, rủi ro | CTO |
| 01 | `01-product-design.md` | Persona, thị trường, đối thủ, USP, ưu tiên feature | Product Manager |
| 02 | `02-domain-design.md` | Bounded Context, Event Storming, Aggregate, Domain Event | Principal Architect |
| 03 | `03-service-design.md` | Toàn bộ microservices, trách nhiệm, DB, event, scaling | Staff Backend |
| 04 | `04-database-design.md` | ERD, bảng, quan hệ, multi-tenant | Staff Backend |
| 05 | `05-ai-architecture.md` | RAG, embedding, chunking, video/OCR/STT, quiz pipeline | AI Architect |
| 06 | `06-event-driven.md` | Kafka topics, producer/consumer, retry, DLQ, outbox | Principal Architect |
| 07 | `07-api-security.md` | REST API, gateway routing, auth flow, JWT, RBAC, upload, AI abuse | Staff Backend + Security |
| 08 | `08-infrastructure.md` | K8s, ingress, mesh, HPA/KEDA, CI/CD, monitoring, backup | DevOps Architect |
| 09 | `09-cost-analysis.md` | Chi phí MVP → 100k users, unit economics | CTO |
| 10 | `10-monetization.md` | 3 mô hình giá, credit model, BYOM, cost control | CTO + PM |
| 11 | `11-roadmaps.md` | MVP roadmap (learning-sequenced) + future AI differentiators | CTO |

---

## 1. Recalibrated Stance: Đây là dự án HỌC TẬP

Bạn đã chốt: **theo đúng full polyglot stack** (NestJS + Spring Boot + Go + Kafka + OpenSearch + K8s) vì mục tiêu là rèn kỹ năng hệ thống và đa ngôn ngữ lập trình — không phải tối ưu thời gian launch.

Quyết định này thay đổi cách tôi tư vấn:

- **"Over-engineering" giờ là tính năng, không phải bug.** Bình thường tôi sẽ ngăn 1 dev dựng 5 service + Kafka + mesh. Ở đây, đó chính là giáo trình.
- **Nhưng tôi không bỏ vai CTO.** Tôi thêm một **Build Order** (thứ tự xây) để bạn không chết chìm khi dựng mọi thứ cùng lúc. Bạn xây *đúng kiến trúc target*, theo *trình tự học được*.
- **Những thứ KHÔNG nhân nhượng dù là dự án học:** unit economics (vì bạn muốn kiếm tiền thật), chất lượng pipeline AI (phần khó nhất, khó hơn toàn bộ phần microservices cộng lại), và các rủi ro kỹ thuật. Tôi flag đầy đủ trong từng phần.

### 1.1. Tiêu chuẩn phát triển và thời điểm triển khai production

Dự án được phát triển cho một sản phẩm production có người dùng thật. Tuy nhiên, hệ thống **chưa được triển khai production trong các phase xây dựng core**. Hai quyết định này không mâu thuẫn:

- **Production-grade engineering từ ngày đầu:** code trong từng phase phải có cấu trúc rõ ràng, contract tường minh, validation, ownership, idempotency, failure handling, bounded resource usage, graceful shutdown, test và cấu hình vận hành phù hợp với phạm vi phase đó.
- **Không giả lập target state quá sớm:** không đưa Kafka, K8s hoặc microservice vào phase trước chỉ để mang nhãn production. Mỗi công nghệ vẫn được thêm theo đúng roadmap và phải thay thế qua seam đã thiết kế, không viết lại business flow.
- **Production launch chỉ sau core phases:** Phase 0 đến Phase 6 phải hoàn thành, sau đó hệ thống phải qua production-readiness review về bảo mật, dữ liệu, tải, quan sát, backup/restore và rollback trước khi phục vụ người dùng thật.
- **Phase completion không đồng nghĩa production release:** một phase có thể hoàn thành về chức năng và kiến trúc nhưng toàn hệ thống vẫn chỉ chạy ở local/dev hoặc staging cho tới khi đạt production launch gate.

Phase 7 là phần mở rộng sau core; Analytics CQRS nên làm theo nhu cầu sản phẩm, còn service mesh là tùy chọn và không chặn lần triển khai production đầu tiên.

---

## 2. Định vị sản phẩm trong 3 câu

1. **Vấn đề:** Người học có hàng giờ video bài giảng, PDF, slide — nhưng học thụ động, quên nhanh, không biết mình yếu chỗ nào.
2. **Giải pháp:** Upload tài liệu → AI sinh quiz, flashcard, checkpoint trong video (video tự pause để hỏi), phát hiện điểm yếu và đề xuất học lại.
3. **Khác biệt:** Interactive video checkpoint + Learning Analytics đóng vòng spaced repetition + tối ưu cho **tiếng Việt** (nơi NotebookLM/Quizlet phục vụ kém).
