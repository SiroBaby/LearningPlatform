# ADR-0034: Phụ đề YouTube là nguồn transcript

## Trạng thái

Đã chốt bởi Owner trong GitHub Issue #161 (thiết kế được duyệt ngày 2026-11-14).
Tài liệu này là contract kiến trúc và vận hành cho bài học YouTube; nó không tự
xác nhận rằng code, image hay hạ tầng đã được triển khai.

## Bối cảnh

[ADR-0032](0032-stt-cho-media-va-citation-thoi-gian.md) đã có đường xử lý nội dung
có mốc thời gian: transcript chia thành chunk, mỗi chunk giữ Locator `time`,
câu hỏi tối đa 30 và trải đều theo timeline. Issue #161 thêm bài học từ video
YouTube. Platform không tải, không phát lại và không gửi audio của YouTube cho
bất kỳ provider nào: Owner tự tải file phụ đề `.vtt` hoặc `.srt` của video mình
có quyền dùng, và web nhúng trình phát YouTube chính thức.

Phụ đề là dữ liệu Owner tự cung cấp và không tin cậy: có thể sai mã hóa, chứa
markup, mốc thời gian chồng lấn hoặc không khớp video.

## Quyết định

1. **Phụ đề là nguồn transcript, không có STT.** Document loại `YOUTUBE` đi theo
   đường văn bản (upload presigned vào bucket `documents` → `confirm` →
   `TEXT_EXTRACT` hoặc `FULL_PIPELINE` theo model), nhưng Go worker đọc cue từ
   snapshot đã parse thay vì đọc object thô, rồi dùng lại `ChunkTranscript`.
   Không gọi STT, không phụ thuộc `AI_MEDIA_STT_ENABLED`, không cần probe.
2. **Node là parser duy nhất.** NestJS đọc object (tối đa 5 MiB), parse VTT/SRT
   bằng regex neo đầu-cuối (thời gian tuyến tính), lưu snapshot vào
   `course.document_subtitle_transcripts` và trả toàn bộ cue để Owner xem trước.
   Go chỉ kiểm tra lại bất biến trên snapshot, không có parser thứ hai.
3. **Owner phải xác nhận quyền.** `POST /documents/:id/confirm` yêu cầu
   `rightsConfirmed: true` cho YOUTUBE (`SUBTITLE_RIGHTS_CONFIRMATION_REQUIRED`)
   và snapshot phải tồn tại (`SUBTITLE_PREVIEW_REQUIRED`). Thời điểm xác nhận
   lưu ở `rights_confirmed_at`; Go chỉ đọc snapshot đã có `rights_confirmed_at`.
   Retry dùng lại xác nhận cũ. Preview mới ghi đè snapshot sẽ xóa xác nhận cũ.
4. **Chỉ lưu `youtube_video_id`.** URL gốc không được lưu. URL được chuẩn hóa
   bằng allowlist host (`youtube.com`, `www`, `m`, `youtu.be`,
   `youtube-nocookie.com`, `www.youtube-nocookie.com`; không `music.youtube.com`)
   và allowlist dạng đường dẫn (`/watch?v=`, `/shorts/`, `/embed/`, `/live/`,
   `/v/`, `youtu.be/{id}`); từ chối userinfo, port lạ, playlist, channel, handle,
   `v` xung đột. `http:` được chấp nhận và chuẩn hóa. CHECK trong database ràng
   buộc `youtube_video_id` có mặt (đúng 11 ký tự `[A-Za-z0-9_-]`) khi và chỉ khi
   `type = 'YOUTUBE'`.
5. **Giới hạn parse.** UTF-8 nghiêm ngặt (một BOM được bỏ), từ chối NUL và ký tự
   điều khiển C0/C1 trừ tab/xuống dòng; NFC; cue có `end <= start` bị từ chối,
   `end` tối đa 24 giờ, cue chồng lấn được giữ và sắp ổn định theo `start`; tối
   đa 10.000 cue, 2.000 code point mỗi cue, 500.000 code point tổng (đơn vị rune,
   khớp Go). Markup (`<c>`, `<v>`, `<i>`, `{\an8}`...) bị bỏ trước, entity được
   giải mã sau đúng một lần, nên `&lt;script&gt;` chỉ là chữ vô hại. Mã lỗi:
   `SUBTITLE_TOO_LARGE`, `SUBTITLE_ENCODING_INVALID`, `SUBTITLE_FORMAT_INVALID`,
   `SUBTITLE_TIMESTAMP_INVALID`, `SUBTITLE_CUE_TOO_LONG`,
   `SUBTITLE_TOO_MANY_CUES`, `SUBTITLE_TOO_MANY_CHARS`, `SUBTITLE_EMPTY`, kèm
   `line` (dòng 1-based) khi xác định được.
6. **Locator thời gian lấy `max(EndSec)`.** Cue chồng lấn không kết thúc theo thứ
   tự, nên mốc kết thúc của chunk là giá trị lớn nhất trong các cue đã gom, không
   phải cue cuối. STT không chồng lấn nên hành vi cũ không đổi.
7. **Credit và số câu hỏi.** Model CUSTOM được phép. Tối đa 30 câu hỏi trải đều
   (cùng `MaxMediaQuestions` của Go). Với model Platform, Node tính credit từ
   `calls = min(chunkCount, MAX_TIMED_DOCUMENT_QUESTIONS)` và
   `chars = ceil(extractedChars * calls / chunkCount)`, để không reserve cho các
   chunk mà Go không sinh câu hỏi. Hằng số này phản chiếu `MaxMediaQuestions`;
   đổi một nơi phải đổi nơi kia.
8. **Vòng đời dữ liệu.** Xóa Document xóa snapshot trong cùng transaction với
   deletion fence; object phụ đề thô được purge qua locator của bucket
   `documents` như file TEXT. Phụ đề thô được giữ tới khi xóa Document. Việc xóa
   vật lý `ai.chunks` và `quiz.*` cho mọi loại Document nằm ngoài phạm vi và theo
   dõi ở #214.
9. **Cờ `YOUTUBE_LESSONS_ENABLED`.** Strict boolean (chỉ chuỗi `true` mới bật),
   mặc định tắt trong template, khai báo là literal trong
   `infra/k8s/apps.yaml.j2` cho API (chặn `upload-url`/`estimate` loại YOUTUBE
   bằng `YOUTUBE_LESSONS_DISABLED`) và web (ẩn lựa chọn nguồn). Owner bật trên
   dev trong cùng PR qua `youtube_lessons_enabled` ở `infra/ansible/vars/dev.yml`.
   Rollback: đặt lại `false`; Document YOUTUBE đã tạo vẫn xem và làm quiz được.
   API cũng chặn `subtitle-preview` và `confirm` mới của YOUTUBE khi cờ tắt
   (409 `YOUTUBE_LESSONS_DISABLED`); `retry` của Document đã được xác nhận quyền
   vẫn được phép để việc xử lý dở dang không bị kẹt khi rollback.

## Hệ quả

- Go worker đọc thêm `course.document_subtitle_transcripts` (chỉ SELECT, join
  `course.documents` theo `id` + `owner_id` + trạng thái `PROCESSING` + loại
  `YOUTUBE`). Đây là ngoại lệ hẹp so với "source descriptor tối thiểu" ở
  `app/AGENTS.md`.
- Trình phát YouTube nhúng ở web cần thêm nguồn vào CSP nếu sau này bật CSP:
  `frame-src https://www.youtube-nocookie.com https://www.youtube.com` và
  `script-src https://www.youtube.com https://s.ytimg.com`. Hiện chưa có CSP.
- Phụ đề không được xác minh là khớp video; Owner xác nhận điều đó cùng với
  quyền sử dụng ở bước `confirm`.
- Reader Node cũ (`ContentDocumentSourceReader`) chỉ hỗ trợ PDF/TEXT nên YOUTUBE
  thất bại an toàn ở đường legacy.
