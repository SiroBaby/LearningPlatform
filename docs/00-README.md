# AI Learning Platform — Bản Thiết Kế Hệ Thống

> Tài liệu kiến trúc cho MVP biến PDF/text, sau đó Video/Audio/STT và OCR, thành trải nghiệm học tập tương tác bằng AI.
> Phục vụ thị trường **Việt Nam / SEA**, khách hàng **B2C** (học sinh, sinh viên, người tự học). Platform Model dùng managed inference; Custom AI/BYOM qua endpoint OpenAI-compatible được mở cho mọi gói khi identity, secret-management, admin feature setting và egress boundary sẵn sàng theo ADR-0021. Local AI Connector thuộc Post-MVP Improvement Backlog.

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

## 1. Recalibrated Stance: Shipping MVP trước

MVP được chốt theo capability có thể shipping: PDF/text baseline → Video/Audio/STT → OCR. MVP giữ NestJS modular monolith, AI Worker Golang và PostgreSQL durable queue; không lấy full polyglot stack làm scope hiện tại.

Quyết định này thay đổi cách tôi tư vấn:

- Chất lượng extraction/grounding và luồng Owner → Quiz → Attempt → Grading là ưu tiên MVP.
- PostgreSQL queue và Go worker là boundary vận hành đủ dùng cho MVP; không thay bằng Kafka chỉ để học công nghệ.
- Redis, Kafka, Spring auth split, API Gateway, OpenSearch/RAG, service split, KEDA/HPA/HA, GitOps, mesh và CQRS thuộc **Post-MVP Improvement Backlog** trong `11-roadmaps.md`.

### 1.1. Tiêu chuẩn phát triển và thời điểm triển khai production

Dự án được phát triển cho một sản phẩm production có người dùng thật. Tuy nhiên, hệ thống **chưa được triển khai production trong các capability MVP**. Hai quyết định này không mâu thuẫn:

- **Production-grade engineering từ ngày đầu:** code trong từng capability phải có cấu trúc rõ ràng, contract tường minh, validation, ownership, idempotency, failure handling, bounded resource usage, graceful shutdown, test và cấu hình vận hành phù hợp với phạm vi capability đó.
- **Không mở rộng hạ tầng trong MVP:** không thêm broker, datastore, cluster topology, autoscaling hay platform vận hành mới chỉ để đón trước nhu cầu.
- **Production launch cần gate riêng:** hoàn thành capability MVP không mặc nhiên là đủ điều kiện phục vụ production traffic.
- **Hoàn thành capability không đồng nghĩa production release:** một capability có thể hoàn thành về chức năng và kiến trúc nhưng toàn hệ thống vẫn chỉ chạy ở local/dev hoặc staging cho tới khi đạt production launch gate.

Các hạng mục mở rộng được xem lại sau MVP theo problem statement và bằng chứng nhu cầu, không theo lịch cố định.

---

## 2. Định vị sản phẩm trong 3 câu

1. **Vấn đề:** Người học có hàng giờ video bài giảng, PDF, slide — nhưng học thụ động, quên nhanh, không biết mình yếu chỗ nào.
2. **Giải pháp:** Upload tài liệu → AI sinh quiz, flashcard, checkpoint trong video (video tự pause để hỏi), phát hiện điểm yếu và đề xuất học lại.
3. **Khác biệt:** Interactive video checkpoint + Learning Analytics đóng vòng spaced repetition + tối ưu cho **tiếng Việt** (nơi NotebookLM/Quizlet phục vụ kém).
