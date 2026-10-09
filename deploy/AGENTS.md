# Quy tắc automation triển khai

- Selector GHCR không có candidate phải xuất đúng 0 byte; không bỏ qua dòng ID trống/malformed trong deleter để che lỗi contract. Kiểm thử phải nối đầu ra selector thật vào deleter thật và xác nhận không có DELETE.
- Preflight toàn bộ file và ID của các package được phép trước request DELETE đầu tiên; list và delete phải dùng cùng owner/package contract. Dry-run chỉ đọc file allowlist, không dùng glob rộng.
- Thu thập digest qua SSH phải giữ JSONPath là một argument, có timeout/keepalive hữu hạn và chỉ publish file sau khi mọi query thành công, mọi image được quản lý dùng digest bất biến. Fixture phải thực thi payload remote thật qua lệnh Kubernetes giả lập.
- Cleanup schedule chạy từ default branch main; đối chiếu source trên exact run SHA, tạo PR từ nhánh riêng vào main. CI kiểm thử cleanup không có package write credential hoặc SSH secret và không thực hiện DELETE thật.
