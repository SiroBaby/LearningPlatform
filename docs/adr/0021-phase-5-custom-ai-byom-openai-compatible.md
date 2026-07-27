# Custom AI/BYOM qua OpenAI-compatible endpoint cho mọi gói

## Bối cảnh

Custom AI ban đầu được xem là quyền lợi của gói trả phí. Cách giới hạn này làm giảm khả năng tiếp cận của người dùng Free, trong khi Custom AI chuyển chi phí inference sang provider do Owner tự chọn và không tiêu thụ platform credit. Nền tảng cũng cần phân biệt rõ Custom AI do Owner quản lý với Platform Model do operator cấu hình qua environment hoặc secret manager cho các gói subscription.

## Quyết định

Custom AI được cung cấp cho mọi Owner, gồm cả Free và các gói trả phí. Mỗi Owner cá nhân có thể tạo nhiều **Custom AI Configuration**, chọn một cấu hình cụ thể cho từng Document và không có cấu hình active toàn tài khoản. Mỗi cấu hình gồm tên hiển thị, `base_url`, `model`, `api_key` tùy chọn và trạng thái xác minh. Team sharing chưa thuộc phạm vi đầu tiên.

Contract đầu tiên chỉ hỗ trợ OpenAI-compatible endpoint. Endpoint có thể là OpenAI, OpenRouter, LiteLLM, Ollama, vLLM hoặc proxy tương thích nếu worker SaaS truy cập được. Anthropic native API, Claude Code và Local AI Connector không thuộc phiên bản đầu; adapter hoặc connector riêng chỉ được thêm ở phase sau.

Owner có thể lưu cấu hình ở trạng thái `UNVERIFIED`, nhưng chỉ cấu hình `VERIFIED` mới được chọn để xử lý. Thay đổi `base_url`, `model` hoặc `api_key` đưa cấu hình về `UNVERIFIED`. Kiểm tra kết nối do Owner chủ động kích hoạt, dùng request nhỏ có timeout và giới hạn response, không tự retry và chuẩn hóa lỗi thành các mã như `ENDPOINT_UNREACHABLE`, `AUTHENTICATION_FAILED`, `MODEL_NOT_FOUND` và `INCOMPATIBLE_RESPONSE`.

API key là secret cấp Owner: chỉ lưu ciphertext bằng KMS/Vault/envelope encryption, giải mã trong memory ngay trước khi gọi, không trả lại plaintext và không log. Response chỉ cho biết `hasApiKey`. Secret có version để attempt đã claim không bị thay đổi khi Owner rotate hoặc xóa cấu hình. Xóa cấu hình là soft delete; secret chỉ bị xóa vật lý sau khi không còn attempt đang chạy cần version đó. ProcessingJob giữ `customModelConfigId`, `provider_identity` và metadata kiểm toán, không sao chép API key.

`base_url` là input không tin cậy: canonicalize và validate scheme/host/port, chặn metadata, loopback, link-local và private network theo mặc định, chống DNS rebinding và ép egress qua transport được kiểm soát. SaaS không gọi `localhost` trên máy Owner. Self-hosted deployment chỉ được gọi private endpoint khi operator khai báo egress policy riêng.

Admin chỉ quản lý System Feature Setting `customAiEnabled`. Admin không tạo model dùng chung, không xem hoặc quản lý Custom AI Configuration của Owner, và không quản lý Platform Model qua giao diện. Feature setting lưu trong database, có audit người thay đổi, giá trị cũ/mới và thời điểm; environment chỉ có thể cung cấp default hoặc emergency kill switch. Khi flag tắt, hệ thống chặn thao tác tạo, sửa, xác minh, chọn, confirm và retry mới bằng Custom AI nhưng không xóa cấu hình, không hủy attempt đang chạy và không ảnh hưởng Quiz đã tạo.

Platform Model tiếp tục do operator cấu hình qua environment/secret manager và tiêu thụ platform credit. Custom AI không tiêu thụ platform credit, nhưng giao diện phải cảnh báo provider của Owner có thể tính phí trực tiếp.

Mọi cache và audit identity dùng `provider_identity = hash(provider_type + canonical_base_url + model + transport + structured_output_mode + capability_version)`; API key không tham gia hash. `GenerationCache` và `prompt_version` dùng identity này để không dùng nhầm cache hoặc dedup nhầm Quiz. Custom AI vẫn phải đi qua timeout, bounded resource limits, structured-output validation, usage/audit metadata, aggregate validation, ownership và content-safety boundary như Platform Model.

## Hệ quả

- Free plan có thêm đường xử lý không tiêu thụ platform credit nhưng không được miễn các giới hạn chống abuse, rate limit hoặc bảo mật.
- Nền tảng nhận thêm trách nhiệm quản lý secret và egress an toàn.
- Chất lượng và chi phí Custom AI phụ thuộc provider của Owner; lỗi phải được phân loại riêng, không trình bày như lỗi Platform Model.
- Lát baseline chỉ được mở khi có ownership, secret-management, verification, feature setting và egress guard tối thiểu; Phase 5 hardening bổ sung identity/admin production boundary và vận hành ở quy mô lớn. Quyền sử dụng không phụ thuộc subscription entitlement.
