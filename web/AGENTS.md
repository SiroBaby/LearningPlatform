<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

- Shared layout của route dùng dữ liệu thật không được hiển thị số lượng, trạng thái hoặc quyền sử dụng lấy từ dữ liệu mẫu. Route tương lai dùng dữ liệu mẫu phải có nhãn `Dữ liệu minh họa` rõ ràng.
- Tên component, hook, class, type, function, biến, constant, route helper, API client và file phải mô tả trách nhiệm ổn định; không gắn tên theo giai đoạn như `Phase0`, `Mvp`, `Temporary`, `New` hoặc `Legacy` nếu thành phần dự kiến tiếp tục tồn tại. Chỉ dùng tên tạm thời khi có kế hoạch loại bỏ rõ ràng; thành phần lâu dài phải có một tên thống nhất và được dùng xuyên suốt.
- Nội dung trên màn hình dành cho người dùng chỉ giải thích việc họ có thể làm, trạng thái họ cần biết, kết quả và cách xử lý tiếp theo. Không đưa chi tiết triển khai như frontend/backend, API, BFF, route, contract, storage, polling, HTTP status, `sessionStorage`, ID nội bộ hoặc tên kỹ thuật vào giao diện thông thường; chuyển các chi tiết đó sang log, tài liệu kỹ thuật hoặc màn hình quản trị khi cần.
- Ưu tiên từ ngữ ngắn, quen thuộc với người dùng Việt Nam và câu chủ động dễ hiểu. Chỉ mượn từ tiếng Anh khi đó là thuật ngữ người dùng thực sự quen dùng hoặc không có cách diễn đạt tiếng Việt rõ hơn; dùng đúng nghĩa và nhất quán, không trộn Việt-Anh để làm câu khó đọc.
- Trước khi hoàn tất thay đổi giao diện, đọc lại toàn bộ tiêu đề, mô tả, trạng thái, lỗi và nút bấm theo góc nhìn người dùng; loại bỏ câu mô tả kiến trúc, lời tự giải thích của hệ thống và thông tin không giúp người dùng ra quyết định.
- Số thứ tự câu hỏi hiển thị cho người học phải lấy từ vị trí trong danh sách đã serve (`index + 1`), không lấy trực tiếp từ persisted `ordinal`, vì dữ liệu cũ có thể có ordinal trùng theo chunk.
- Client Component được SSR không được đọc `sessionStorage`/`localStorage` để tạo initial render. Khởi tạo markup xác định giống server, restore draft sau mount, và chặn timer/persist cho đến khi restore hoàn tất để tránh hydration mismatch hoặc ghi đè dữ liệu cũ.
- Khi người dùng xác nhận rời màn hình làm quiz, phải persist snapshot mới nhất và tháo `beforeunload`/`popstate` guard trước khi điều hướng. Với history sentinel, dùng full navigation cho lần rời đã xác nhận để tránh App Router transition bị sentinel giữ lại.
- Practice chỉ gọi feedback API sau action `Kiểm tra đáp án`; chọn option hoặc chuyển câu không được tự gọi feedback, và thay đổi option phải vô hiệu feedback/request cũ.
- Runtime response parser phải dùng đúng toàn bộ literal values mà backend thực sự persist hoặc phát qua API, bao gồm trạng thái trung gian; khi backend thêm một literal mới, cập nhật frontend union, parser và regression test trong cùng thay đổi.
- BFF error sanitization phải giữ các field máy đọc an toàn như `code`, `message`, `retryable`; không rút gọn mọi lỗi thành message khiến client phải đoán nghiệp vụ từ text, và không chuyển tiếp field backend tùy ý chưa allowlist.
- Nút retry cho async processing phải gọi command re-arm hiện hữu và chặn submit trùng; reload hoặc polling chỉ dùng để đọc trạng thái sau command, không được giả làm retry. UI chỉ hiển thị message đã qua typed client error sanitizer, còn lỗi runtime không xác định phải dùng copy fallback an toàn.
- Mỗi route riêng tư phải có trong matcher của `src/proxy.ts`; mọi thay đổi auth navigation phải kiểm tra cả guest redirect, phiên hợp lệ và trang `not-found` để UI không hiển thị prompt đăng nhập sai trạng thái.
- Mọi server-side auth session check phải gọi `/internal/v1/auth/me` qua `requestAuthBackend` (mTLS); không gọi lại endpoint public hoặc legacy `/api/v1/auth/me`.
- Public route dùng shared navigation phải resolve session ở Server Component và truyền boolean tường minh vào Client Component; không default sang guest trong topbar vì user đã đăng nhập sẽ nhận menu Login sai trên route như FAQ/Privacy/Pricing.
- Auth flow có nested responsive grid phải dùng container width đủ cho các cột ở desktop; kiểm tra breakpoint rộng để tránh cột chính bị co ngoài ý muốn.
- Runtime test khởi chạy Next/npm phải đặt process vào process group riêng và dừng toàn bộ process tree trong cleanup; không chỉ kill process wrapper để tránh orphan `next-server` làm CI treo sau khi assertion đã pass.
<!-- END:nextjs-agent-rules -->
