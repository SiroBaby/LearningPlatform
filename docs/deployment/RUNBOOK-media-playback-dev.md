# RUNBOOK phát media bằng presigned GET trên dev K3s (#162)

Tài liệu này dành cho owner trước khi bật phát video/audio cho người học. Backend chỉ cấp URL
đọc có thời hạn; bucket vẫn private và không thêm CORS.

## 1. Tính năng này làm gì

- **Dùng để làm gì**: người học mở Document `AUDIO`/`VIDEO` ở trạng thái `READY` trong thư viện và
  nghe/xem trực tiếp từ object storage, không đi qua API Node.
- **Cách chạy**:
  1. Trình duyệt gọi BFF `POST /api/phase0/documents/:id/playback-url`, BFF chuyển tới backend
     `POST /api/v1/documents/:id/playback-url` kèm session.
  2. Backend kiểm tra owner (`findByOwnerId`) ở mỗi lần gọi, chỉ cho `READY`, rồi ký presigned
     GET khóa đúng `VersionId` đã lưu ở `mediaSource*` (không đọc "version mới nhất").
  3. Thời hạn URL (TTL, thời gian sống): `min(12h, max(4h, thời lượng + 2h))`. Trình duyệt tự xin URL
     mới trước khi hết hạn 15 phút và đổi nguồn mà không mất vị trí đang xem.
- **Mã lỗi**: `404 DOCUMENT_NOT_FOUND`, `409 MEDIA_PLAYBACK_NOT_AVAILABLE` (không phải audio/video),
  `409 MEDIA_PLAYBACK_NOT_READY`, `409 MEDIA_SOURCE_IDENTITY_UNAVAILABLE`,
  `503 MEDIA_PLAYBACK_UNAVAILABLE` (media tắt hoặc ký lỗi, thân lỗi an toàn).
- **Log**: `media.playback.url_issued`, `media.playback.url_rejected`, `media.playback.sign_failed`.
  Log không bao giờ chứa URL, key, chữ ký hay query string.

## 2. Owner cấp IAM (qua AWS Console, repo không đụng AWS)

Identity API cho media bucket (cùng cặp `mediaApiAccessKey`/`mediaApiSecretKey` đang ký presigned POST)
cần thêm quyền đọc, giới hạn trong prefix `media/*`:

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:GetObjectVersion"],
  "Resource": "arn:aws:s3:::<media-bucket>/media/*"
}
```

- Trạng thái dev hiện tại: **thiếu `s3:GetObjectVersion`** (đã có `s3:GetObject`). Presigned GET có
  `versionId` sẽ trả `403` khi mở URL nếu thiếu quyền này. Owner thêm trước khi bật tính năng.
- URL được ký bằng khóa dài hạn của IAM user, nên URL sống đúng TTL đã ký (tối đa 12 giờ). Nếu ký bằng
  khóa tạm (STS) thì URL chết cùng phiên; không dùng cách đó cho API này.
- Không cấp `s3:ListBucket`, `s3:PutObject` hay `s3:DeleteObject` thêm cho tính năng này.

## 3. CORS và bucket

- **Không cần CORS**: player không đặt `crossOrigin`, nên trình duyệt phát media như tài nguyên
  không-CORS (Range request vẫn hoạt động). Nếu sau này thêm `crossOrigin` (ví dụ phụ đề, WebAudio)
  thì mới phải cấu hình CORS cho media bucket.
- Bucket giữ private và bật versioning như hiện tại; không bật public read, không đổi bucket policy.

## 4. Kiểm tra sau khi owner thêm IAM

1. Đăng nhập, mở một video `READY` trong `/library/<id>`: player hiện ra và phát được.
2. Tua tới giữa video: trình duyệt gửi Range request, storage trả `206`.
3. Gọi API mà không đăng nhập: `401`. Gọi bằng tài khoản khác: `404`.
4. Xem log API: có `media.playback.url_issued` với `ttlSec`, không có `X-Amz-Signature` hay key.
5. Nếu mở URL báo `403`: kiểm tra `s3:GetObjectVersion` trên `media/*` và `versionId` của Document.

## 5. Giới hạn đã biết

- Chưa có rate limit phía server cho endpoint này; client tự giới hạn số lần thử lại.
- URL đã cấp vẫn dùng được tới hết TTL dù Document bị xóa sau đó; purge xóa theo `VersionId` nên
  object biến mất ngay khi purge chạy xong.
- Chưa có nút "Nghe đoạn này" từ kết quả quiz (sẽ làm ở ticket riêng).
