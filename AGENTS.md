# Repository Service Map

Repository này chứa nhiều phạm vi độc lập. Không đặt coding rule của một service ở root.

- NestJS backend: xem `app/AGENTS.md`.
- Next.js frontend: xem `web/AGENTS.md`.
- Domain, ADR và PRD ở root `CONTEXT.md` và `docs/` là nguồn tham khảo chung, không phải coding rule cho mọi service.
- Issue cục bộ nằm trong `.scratch/<feature>/issues/`.

## Cải tiến quy tắc sau khi sửa lỗi

- Sau khi sửa một lỗi có nguyên nhân lặp lại được, AI phải cập nhật `AGENTS.md` của service liên quan với quy tắc ngắn gọn, có thể áp dụng lại để ngăn lỗi tái diễn.
- Chỉ ghi nhận bài học đã được xác minh; không thêm quy tắc cho lỗi môi trường tạm thời hoặc trường hợp đơn lẻ không có tính khái quát.

## Deployment

- Với inventory Ansible tùy chỉnh, đặt biến group tại `<inventory-dir>/group_vars/<group>.yml` hoặc nạp bằng `vars_files`; không đặt ở thư mục khác rồi giả định Ansible sẽ tự tìm thấy.
- Trong `ansible.builtin.assert.that`, mọi dấu `-` phải cùng mức thụt lề; YAML có thể gộp dòng lệch một space vào biểu thức trước mà syntax-check vẫn không báo lỗi.
- Remote deploy phải dùng đúng deployment path đã cấu hình xuyên suốt bước upload và execute; không dựa vào default path khác với GitHub Environment.
- Chỉ promote release state sau khi toàn bộ service health check pass. Rollback first deployment chỉ được dọn container của candidate, không teardown volume hoặc hạ tầng dùng chung.
- Backend deployment phải chạy tracked SQL migrations từ release image bằng bounded one-shot Job và chờ hoàn tất thành công trước khi apply API hoặc worker; không dựa vào application startup để tự tạo schema.
- Automatic environment deployment chỉ chạy từ branch môi trường đã chỉ định. Phân loại thay đổi theo runtime và không build, restart hoặc rollback service không bị ảnh hưởng; shared backend change phải chọn mọi runtime backend phụ thuộc.
- Tách registry/SSH credential của CI khỏi application runtime credential. Không bake secret vào image; production orchestration ưu tiên workload identity hoặc secret manager thay vì sao chép static key theo node.
