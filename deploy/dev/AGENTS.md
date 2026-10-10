# Quy tắc automation triển khai dev

- Khi tách job build, giữ gate kiểm tra chất lượng và các tên đầu ra digest mà deploy đang đọc; kiểm thử cả success/skipped/failure/cancelled và chặn mọi runtime được chọn thiếu digest bất biến.
- Retry GHCR phải có số lần/timeout/backoff hữu hạn, chỉ áp dụng cho lỗi push registry đã phân loại. Lỗi build, xác thực, chứng chỉ hoặc lỗi chưa phân loại phải dừng; fixture phải chạy script production và xác nhận không xuất digest khi thất bại.
- Cache build phải tách scope theo runtime, có phiên bản chính sách và dựa vào khóa nội dung của BuildKit; không cache credential hoặc inventory triển khai.
- Job phía sau gate mà không có hàm trạng thái trong `if` sẽ bị GitHub ngầm áp `success()` lên mọi job đứng trước theo bắc cầu, không chỉ `needs` trực tiếp: một job quality bị skip hợp lệ sẽ làm skip mọi build phía sau (run 38045911082). Job nối sau gate phải dùng `always() && needs.<gate>.result == 'success' && ...`, và evaluator trong test phải xét ancestor bắc cầu, có ca quality bị skip.
