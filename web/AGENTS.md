<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

- Shared layout của route dùng dữ liệu thật không được hiển thị số lượng, trạng thái hoặc quyền sử dụng lấy từ dữ liệu mẫu. Route tương lai dùng dữ liệu mẫu phải có nhãn `Dữ liệu minh họa` rõ ràng.
- Tên component, hook, class, type, function, biến, constant, route helper, API client và file phải mô tả trách nhiệm ổn định; không gắn tên theo giai đoạn như `Phase0`, `Mvp`, `Temporary`, `New` hoặc `Legacy` nếu thành phần dự kiến tiếp tục tồn tại. Chỉ dùng tên tạm thời khi có kế hoạch loại bỏ rõ ràng; thành phần lâu dài phải có một tên thống nhất và được dùng xuyên suốt.
- Nội dung trên màn hình dành cho người dùng chỉ giải thích việc họ có thể làm, trạng thái họ cần biết, kết quả và cách xử lý tiếp theo. Không đưa chi tiết triển khai như frontend/backend, API, BFF, route, contract, storage, polling, HTTP status, `sessionStorage`, ID nội bộ hoặc tên kỹ thuật vào giao diện thông thường; chuyển các chi tiết đó sang log, tài liệu kỹ thuật hoặc màn hình quản trị khi cần.
- Ưu tiên từ ngữ ngắn, quen thuộc với người dùng Việt Nam và câu chủ động dễ hiểu. Chỉ mượn từ tiếng Anh khi đó là thuật ngữ người dùng thực sự quen dùng hoặc không có cách diễn đạt tiếng Việt rõ hơn; dùng đúng nghĩa và nhất quán, không trộn Việt-Anh để làm câu khó đọc.
- Trước khi hoàn tất thay đổi giao diện, đọc lại toàn bộ tiêu đề, mô tả, trạng thái, lỗi và nút bấm theo góc nhìn người dùng; loại bỏ câu mô tả kiến trúc, lời tự giải thích của hệ thống và thông tin không giúp người dùng ra quyết định.
<!-- END:nextjs-agent-rules -->
