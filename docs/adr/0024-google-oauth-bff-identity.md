# Google OAuth và định danh qua Next BFF

## Trạng thái

Đã được Owner chốt trong GitHub Issue #108. Đây là quyết định kiến trúc và contract chuẩn bị cho implementation; không tự xác nhận rằng Auth đã được triển khai.

## Bối cảnh

MVP-1 hiện dùng identity stub `X-User-Id` và `PHASE0_DEV_OWNER_ID`. Cách này phù hợp cho fixture local nhưng không cung cấp đăng nhập, session, revoke, role hoặc identity boundary cho người dùng thật. Issue #108 đưa Google OAuth lên trước các capability product surface tiếp theo.

NestJS là nơi sở hữu nghiệp vụ identity và kiểm tra claim của Google. Next.js là Backend for Frontend (BFF, lớp trung gian cùng nguồn với trình duyệt), chịu trách nhiệm điều hướng OAuth và giữ cookie host-only. Browser không gọi API Nest trực tiếp và không nhìn thấy Google token, authorization code hoặc session token dạng plaintext.

Các resource hiện hữu vẫn thuộc boundary `course`, `ai` và `quiz`. Migration Auth không backfill `owner_id` cũ và không thêm foreign key trực tiếp từ resource sang identity trong đợt đầu.

## Quyết định

### 1. Mô hình định danh

- Chỉ hỗ trợ Google OAuth; không triển khai password, email verification, forgot-password hoặc reset-password riêng.
- Mọi Google Account có `email_verified=true` đều được phép đăng nhập; domain email không phải security boundary.
- `google_sub` là identity canonical và unique. Email chỉ là thuộc tính hồ sơ, được `trim` và lowercase bằng `String.prototype.toLowerCase()` không phụ thuộc locale.
- Email không được dùng để liên kết legacy owner, cấp quyền hoặc quyết định thay thế `google_sub`.
- Mỗi lần login thành công, email được đồng bộ theo `google_sub`; xung đột unique phải được xử lý graceful và không làm crash request.

### 2. Luồng OAuth và BFF

Luồng chuẩn:

```text
Browser
  -> Next GET /auth/google/start
  -> Next --mTLS/internal--> Nest POST /api/v1/internal/auth/google/start
  -> Nest tạo state + nonce + PKCE, lưu OAuth transaction PostgreSQL
  -> Browser redirect tới Google (prompt=select_account)
  -> Google callback về Next GET /auth/google/callback
  -> Next gửi code + state tới Nest internal exchange
  -> Nest verify state/nonce/PKCE + iss/aud/exp/email_verified/google_sub
  -> Nest tạo access session và refresh session opaque
  -> Nest trả session pair qua mTLS nội bộ
  -> Next set cookie HttpOnly, Secure, SameSite=Lax, host-only
  -> Next redirect URL sạch, không còn code/state
```

- Nest tạo, lưu và consume `state`, `nonce`, PKCE transaction; Next không tự tạo verifier mà Nest không thể kiểm tra.
- Callback exchange ngay trong cùng request rồi redirect về URL cố định trong allowlist. Không nhận `redirect_uri` tùy ý từ query.
- User nhập email chỉ để truyền `login_hint`; tài khoản được chọn trên Google và token đã verify mới quyết định identity.
- Lỗi OAuth, gồm `access_denied`, state mismatch, nonce mismatch, token invalid, suspended và deleted, đều redirect cùng thông báo generic. Không đưa email, user ID, code hoặc reason nội bộ vào URL.

### 3. Session và cookie

- Access session opaque có thời hạn 15 phút.
- Refresh session opaque có thời hạn 30 ngày và chỉ được dùng ở route refresh.
- Cả hai cookie đều `HttpOnly`, `Secure`, `SameSite=Lax`, host-only trên web host. Local có thể tắt `Secure` riêng theo cấu hình local.
- PostgreSQL chỉ lưu hash token. Refresh token rotation dùng `session_family_id`, token hiện tại, rotation counter hoặc previous hash, `revoked_at` và `revoked_reason` để phát hiện reuse và revoke toàn family.
- Next BFF đọc cookie phía server và forward access token qua `Authorization: Bearer` tới Nest bằng private network và mTLS. Browser không gọi Nest auth trực tiếp.
- Session invalid, expired, revoked, suspended hoặc deleted đều trả cùng response `401`. Error shape và hành vi phải ổn định, không tạo timing side-channel có ý nghĩa.

### 4. Schema identity

Migration chỉ additive, chạy bởi tracked migration runner trước readiness và có PostgreSQL advisory lock.

#### `auth.users`

| Field | Kiểu | Ràng buộc và ý nghĩa |
| --- | --- | --- |
| `id` | UUID | Khóa chính nội bộ |
| `google_sub` | varchar | Unique, identity canonical từ Google |
| `normalized_email` | varchar | Unique, trim + lowercase; không strip dot/alias |
| `email_verified` | boolean | Chỉ login khi `true` |
| `role` | varchar | `USER` hoặc `ADMIN`, check constraint mở rộng được |
| `status` | varchar | `ACTIVE`, `SUSPENDED`, `DELETED` |
| `deleted_at` | timestamptz | Chỉ có giá trị khi `DELETED` |
| `created_at`, `updated_at` | timestamptz | UTC |

`google_sub` là nguồn sự thật. User mới mặc định `USER`. Allowlist `AUTH_ADMIN_GOOGLE_SUBS` được parse và validate lúc bootstrap; mỗi login thành công có thể promote `USER -> ADMIN` atomically nếu `sub` nằm trong allowlist. Xóa sub khỏi allowlist không tự demote; demotion là thao tác explicit có audit reason.

#### `auth.user_profiles`

| Field | Kiểu | Ràng buộc và ý nghĩa |
| --- | --- | --- |
| `user_id` | UUID | FK tới `auth.users.id`, `ON DELETE CASCADE` |
| `display_name` | varchar | Có thể sửa; không bị login Google ghi đè sau khi user chỉnh |
| `avatar_url` | varchar | Metadata hiển thị, không dùng cho authorization hoặc tải tài nguyên nội bộ |
| `learning_goal` | varchar | Nullable |
| `preferred_language` | varchar | Nullable, allowlist/check constraint |
| `proficiency_level` | varchar | Nullable, allowlist/check constraint |
| `onboarding_completed_at` | timestamptz | Nullable |
| `onboarding_skipped_at` | timestamptz | Nullable; loại trừ `completed_at` |

Profile không tham gia quyết định quyền. `DELETED` không cascade resource product; Document/Quiz/Attempt giữ nguyên cho audit, idempotency, outbox và lịch sử grading. User-facing query và presigned URL phải loại identity đã deleted. PII/profile có thể redact hoặc anonymize theo retention policy ở follow-up.

#### `auth.sessions`

Session lưu hash access/refresh theo thiết kế implementation hoặc tách access state khỏi refresh state nếu access được xác minh stateless. Tối thiểu phải có `user_id`, `session_family_id`, `token_hash`, expiry, rotation/revoke metadata, `created_at`, `last_used_at` và audit device/IP đã sanitize. Index bắt buộc gồm token lookup, family lookup và active session theo user; session cascade khi user bị xóa.

#### `auth.oauth_transactions`

| Field | Kiểu | Ràng buộc và ý nghĩa |
| --- | --- | --- |
| `state_hash` | varchar | Unique; không lưu state plaintext |
| `nonce_hash` | varchar | Hash để đối chiếu nonce trong ID token |
| `pkce_verifier_ciphertext` | bytea/text | Mã hóa authenticated encryption (AES-GCM hoặc tương đương) |
| `environment` | varchar | Cô lập local/shared-dev/production |
| `max_attempts`, `attempt_count` | integer | Tăng atomic, mặc định max 3–5 |
| `expires_at` | timestamptz | TTL 10 phút |
| `consumed_at`, `failed_at` | timestamptz | Giữ 24–72 giờ cho audit rồi housekeeping |
| `created_at` | timestamptz | UTC |

Callback tự từ chối transaction hết hạn hoặc đã consume. Exchange consume row bằng transaction/atomic update để callback đồng thời chỉ một request thành công. CronJob gọi CLI cleanup theo batch, idempotent, `concurrencyPolicy: Forbid`; cleanup không phải security boundary.

### 5. API contract

Public route chỉ tồn tại ở Next BFF:

| API | Mục đích |
| --- | --- |
| `GET /auth/google/start` | Khởi tạo OAuth và redirect Google |
| `GET /auth/google/callback` | Nhận code/state, exchange ngay, redirect URL sạch |
| `POST /auth/refresh` | Rotation refresh cookie |
| `POST /auth/logout` | Revoke session/family |
| `GET /auth/me` | Trả user hiện tại qua BFF |

Nest internal route:

| API | Mục đích |
| --- | --- |
| `POST /api/v1/internal/auth/google/start` | Tạo transaction và authorization URL |
| `POST /api/v1/internal/auth/google/exchange` | Verify callback và trả session pair |
| `POST /api/v1/internal/auth/refresh` | Rotate refresh session |
| `POST /api/v1/internal/auth/revoke` | Revoke session/family |
| `GET /api/v1/internal/auth/me` | Trả user UUID, email, display name, role, status |

Internal route không đi qua public ingress, có NetworkPolicy và service authentication mTLS. Nest kiểm tra chain CA, expiry, SAN/SPIFFE identity và scope theo route; private IP chỉ là defense-in-depth, không phải authentication. Response không log token hoặc provider response raw.

### 6. CSRF, rate limit và lỗi

- Cookie BFF dùng `SameSite=Lax`; mọi authenticated mutation kiểm tra `Origin` allowlist cố định, fallback `Referer` khi thiếu Origin, và `Sec-Fetch-Site` nếu có.
- Thiếu cả Origin và Referer trên mutation authenticated trả `403` generic. OAuth callback dùng state/nonce riêng, không miễn CSRF cho route khác.
- Traefik/ingress giới hạn `/auth/google/start` ở 10 request/phút/IP, burst khoảng 3; callback 20 request/phút/IP. Chỉ tin proxy header khi request đi qua proxy được allowlist.
- Mỗi OAuth transaction có `max_attempts` 3–5, tăng atomic trong PostgreSQL; vượt ngưỡng đánh dấu failed.
- Không rate-limit theo email/login hint. `429` có `Retry-After`, body generic.
- Không log authorization code, token, PKCE verifier, cookie, raw email, state, Origin hoặc Referer.

### 7. Trạng thái, role và offboarding

- `ACTIVE` dùng bình thường; `SUSPENDED` và `DELETED` từ chối session, revoke session atomic và trả `401` generic.
- `DELETED` là soft-delete; admin/support được tra cứu hạn chế cho audit. User không tự đổi status.
- Allowlist Google `sub` chỉ promote ở mỗi login; không tự demote. Offboarding phải xóa sub khỏi allowlist và demote DB bằng tooling có audit reason.
- Status override role; user `ADMIN` nhưng suspended/deleted vẫn bị chặn hoàn toàn.
- Admin bootstrap không có default admin. Allowlist parse lỗi phải fail-closed.

### 8. Queue cancellation và ownership boundary

Nest cập nhật status trước, rồi trong cùng transaction ghi cancellation command/outbox bền vững. Component sở hữu queue nhận command và chuyển job `PENDING/CLAIMABLE -> CANCELLED`; job `RUNNING` bị invalidate bằng attempt fence/cancellation marker. Go worker không query `auth.users`, không nhận identity snapshot tùy ý và không tạo cross-schema transaction.

Trước mọi persist extraction/quiz, worker dùng conditional write kiểm tra job chưa bị cancel, attempt fence còn khớp và cancellation đã được áp dụng. Nếu không còn hợp lệ, bỏ kết quả và không retry. Job `COMPLETED` giữ nguyên. Cancellation và audit event phải idempotent.

### 9. Môi trường, cấu hình và rollout

- Local và automated test có thể dùng `IDENTITY_MODE=stub` explicit; shared dev và production bắt buộc Google auth thật.
- Nếu `NODE_ENV=production` và stub mode được bật, app fail-closed lúc startup; production không fallback khi feature flag auth tắt.
- `PHASE0_DEV_OWNER_ID` và `X-User-Id` bị reject/không được đọc ở production. Chỉ xóa biến production sau khi BFF, cookie, mTLS, ownership và E2E đã pass.
- OAuth client ID/secret tách theo environment; Google Console allowlist redirect URI chính xác, không wildcard. Secret chỉ ở Nest Secret/SSM, không vào Next hoặc image.
- Rollout theo expand/contract: migration additive -> auth code/mTLS/OAuth config -> readiness/contract checks -> local Google -> shared dev Google -> production auth-only -> theo dõi ổn định -> contract/remove stub seam.
- Rollback code phải tương thích schema đã migrate; không drop auth tables để rollback.

### 10. Kiểm thử và tiêu chí chấp nhận

CI dùng fake OIDC/Google provider deterministic, có authorization redirect, token exchange, JWKS/signature và các lỗi claim/state/nonce/expiry/email verification. PostgreSQL thật trong container kiểm migration, session rotation, revoke và reuse detection. mTLS dùng CA/certificate fixture riêng.

Shared dev dùng Google thật để kiểm tra redirect, cookie, BFF và mTLS topology. Production chỉ smoke thủ công bằng account/test data riêng và có cleanup. Không đưa credential thật vào CI.

Acceptance tối thiểu:

1. Google account mới tạo user `USER`; account đã có `google_sub` đăng nhập lại đúng user.
2. State, nonce, PKCE, issuer, audience, expiry và `email_verified` được verify fail-closed.
3. Refresh rotation, reuse detection, logout revoke và status revoke có test.
4. BFF chỉ set host-only cookie; browser không thấy token và không gọi Nest trực tiếp.
5. Internal route yêu cầu mTLS đúng service identity và scope.
6. Production/shared dev reject stub và `X-User-Id`; local/test stub cần bật explicit.
7. Ownership, IDOR, resource hiding và presigned URL của deleted user được kiểm tra.
8. Migration, cleanup CLI, cancellation/outbox và rollback compatibility có evidence.

## Các quyết định chưa thuộc Issue #108

- Admin UI và workflow demotion qua API thuộc #109; tooling demotion tối thiểu phải có trước production auth.
- Product data purge/anonymization theo retention là follow-up.
- Redis rate limiter cluster-wide chỉ bổ sung khi topology cần; không phải nguồn sự thật của session.
- Spring Boot auth split, JWT/JWKS migration và public API Gateway không nằm trong #108.

## Hệ quả và rủi ro

- BFF tăng trách nhiệm server-side cookie forwarding và mTLS certificate rotation.
- PostgreSQL có thêm identity/session transaction nhưng vẫn là durable boundary hiện hữu.
- One-way admin promotion yêu cầu quy trình offboarding nghiêm ngặt để tránh quyền tồn tại ngoài allowlist.
- Google outage làm login/worker-dependent smoke thất bại; không được sửa bằng fallback identity hoặc retry vô hạn.
- Legacy resource rows không có FK tới `auth.users` trong migration đầu, vì vậy application phải giữ ownership filter và audit contract rõ ràng.
