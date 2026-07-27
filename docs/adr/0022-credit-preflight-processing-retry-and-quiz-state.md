# Credit preflight, reserve trước enqueue và Quiz API phản ánh trạng thái Document

## Bối cảnh

Luồng hiện tại có thể nhận upload, enqueue ProcessingJob rồi mới reserve credit trong worker. Khi Owner không đủ credit, Document chuyển thành `FAILED`, Quiz không được tạo và `GET /documents/{id}/quiz` trả `404`. Chuỗi hành vi này làm một lỗi nghiệp vụ dự đoán được trông giống lỗi runtime hoặc tài nguyên không tồn tại, đồng thời buộc Owner upload lại dù object nguồn vẫn hợp lệ.

## Quyết định

Hệ thống dùng hai lớp kiểm tra credit cho Platform Model:

1. API estimate thực hiện **Credit preflight** trước upload và trả `availableCredits`, `requiredCredits`, `shortfallCredits` cùng `canProcess`. Khi kết quả cho biết không đủ credit, giao diện chặn bắt đầu upload bằng Platform Model và đưa lựa chọn Custom AI, file nhỏ hơn hoặc thay đổi gói/credit. Kết quả này không khóa số dư.
2. `POST /documents/{id}/confirm` kiểm tra và reserve credit có tính quyết định trước khi chuyển Document sang `PROCESSING` và trước khi enqueue ProcessingJob. Reserve nằm trong transaction thuộc schema `course`; không reserve khi cấp upload URL.

Balance có thể thay đổi sau một preflight thành công. Nếu không đủ credit tại confirm, API trả `402 Payment Required` với code `INSUFFICIENT_CREDITS` và ba giá trị credit trên. Document giữ `UPLOADED`, không tạo ProcessingJob và không ghi lỗi processing. Owner có thể đổi lựa chọn model rồi confirm lại mà không upload lại object. Custom AI có `requiredCredits = 0` đối với platform credit và phải kèm cảnh báo rằng provider riêng có thể tính phí.

Owner được đổi lựa chọn model khi Document ở `UPLOADED`, hoặc khi Document ở `FAILED` và không có attempt đang chạy. Khi đổi model, hệ thống tính lại estimate. Mỗi retry tạo Processing attempt mới với attempt fence và reserve-settle độc lập; tối đa một attempt của một Document được chạy đồng thời. Retry do Owner chủ động kích hoạt, có rate limit và không có automatic LLM retry trong phiên bản đầu.

Lỗi retry được khi nguyên nhân có thể thay đổi, gồm thiếu credit, timeout hoặc provider tạm thời không truy cập được. Lỗi cố định của object như PDF không hợp lệ, không có text layer, object không tồn tại hoặc vượt resource limit không được retry cho tới khi Owner thay Document. Nếu attempt thất bại trước provider dispatch, hệ thống release toàn bộ credit đã reserve. Nếu usage xác định được, settle theo usage thật; nếu dispatch đã xảy ra nhưng usage không xác định, phần chưa xác định giữ ở `HELD`.

`GET /documents/{id}/quiz` phản ánh trạng thái của Document:

| Trạng thái | HTTP và mã lỗi |
| --- | --- |
| Document không tồn tại hoặc không thuộc Owner | `404 DOCUMENT_NOT_FOUND` |
| `UPLOADED` hoặc `PROCESSING` | `409 QUIZ_NOT_READY` |
| `FAILED` | `409 DOCUMENT_PROCESSING_FAILED`, kèm `retryable` và mã nguyên nhân an toàn |
| `READY` và có Quiz | `200` |
| `READY` nhưng không có Quiz | `500 QUIZ_INVARIANT_VIOLATION`, đồng thời log và alert |

Error response dùng contract ổn định gồm `code`, `message`, `retryable`, metadata an toàn phù hợp và `traceId`. `404` không được dùng để biểu diễn Quiz chưa được tạo vì processing chưa xong hoặc đã thất bại.

## Hệ quả

- Lỗi dự đoán được trước pipeline không làm Document thành `FAILED`; `FAILED` chỉ còn nghĩa pipeline đã thực sự bắt đầu rồi thất bại.
- UI có thể giải thích thiếu credit trước upload và đưa lựa chọn Custom AI, file nhỏ hơn hoặc thay đổi gói/credit.
- Reserve sớm hơn nhưng vẫn không giữ credit cho upload bị bỏ dở.
- Worker giữ `BUDGET_EXHAUSTED` như lớp bảo vệ cuối cho race condition hoặc bất thường, không phải luồng thiếu credit thông thường.
- Retry không yêu cầu upload lại object hợp lệ và vẫn giữ lịch sử từng attempt để kiểm toán.
