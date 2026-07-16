# Repository Service Map

Repository này chứa nhiều phạm vi độc lập. Không đặt coding rule của một service ở root.

- NestJS backend: xem `app/AGENTS.md`.
- Next.js frontend: xem `web/AGENTS.md`.
- Domain, ADR và PRD ở root `CONTEXT.md` và `docs/` là nguồn tham khảo chung, không phải coding rule cho mọi service.
- Issue cục bộ nằm trong `.scratch/<feature>/issues/`.

## Cải tiến quy tắc sau khi sửa lỗi

- Sau khi sửa một lỗi có nguyên nhân lặp lại được, AI phải cập nhật `AGENTS.md` của service liên quan với quy tắc ngắn gọn, có thể áp dụng lại để ngăn lỗi tái diễn.
- Chỉ ghi nhận bài học đã được xác minh; không thêm quy tắc cho lỗi môi trường tạm thời hoặc trường hợp đơn lẻ không có tính khái quát.
