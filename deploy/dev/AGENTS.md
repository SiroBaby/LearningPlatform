# Quy tắc automation triển khai dev

- Khi tách job build, giữ gate kiểm tra chất lượng và các tên đầu ra digest mà deploy đang đọc; kiểm thử cả success/skipped/failure/cancelled và chặn mọi runtime được chọn thiếu digest bất biến.
- Retry GHCR phải có số lần/timeout/backoff hữu hạn, chỉ áp dụng cho lỗi push registry đã phân loại. Lỗi build, xác thực, chứng chỉ hoặc lỗi chưa phân loại phải dừng; fixture phải chạy script production và xác nhận không xuất digest khi thất bại.
- Cache build phải tách scope theo runtime, có phiên bản chính sách và dựa vào khóa nội dung của BuildKit; không cache credential hoặc inventory triển khai.
