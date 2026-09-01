# Issue #108 — Checklist triển khai Auth/Identity

## 1. Mục đích

Checklist này chuyển các quyết định trong [ADR-0024](../adr/0024-google-oauth-bff-identity.md) thành các lát implementation và bằng chứng kiểm chứng. Tài liệu không thay thế GitHub Issue #108 và không coi hạng mục là hoàn tất trước khi có test, rollout và evidence tương ứng.

## 2. Phạm vi triển khai

| Nhóm | Kết quả cần có | Trạng thái |
| --- | --- | --- |
| Identity | Google OAuth-only, `google_sub` canonical | Chưa triển khai |
| BFF | Next start/callback/refresh/logout/me, host-only cookies | Chưa triển khai |
| Nest | Internal auth contract, claim verification, session service | Chưa triển khai |
| Persistence | `auth.users`, `user_profiles`, `sessions`, `oauth_transactions` | Chưa triển khai |
| Security | mTLS, CSRF, rate-limit, generic errors, no secret logging | Chưa triển khai |
| Ownership | Production auth-only, stub chỉ local/test | Chưa triển khai |
| Async boundary | Cancellation command/outbox và attempt fence | Chưa triển khai |
| Verification | Fake OIDC CI, PostgreSQL/mTLS fixture, shared-dev/production smoke | Chưa triển khai |

## 3. Lát implementation

### 3.1. Persistence và migration

- [ ] Tạo migration additive cho schema `auth` và các bảng `users`, `user_profiles`, `sessions`, `oauth_transactions`.
- [ ] Bổ sung unique/index/check constraint đã nêu trong ADR-0024.
- [ ] Bảo đảm migration runner chạy trước readiness và dùng advisory lock.
- [ ] Không backfill `owner_id` legacy, không thêm FK trực tiếp từ Document/Quiz/Attempt.
- [ ] Kiểm tra rollback code tương thích schema đã migrate; không drop bảng auth khi rollback.
- [ ] Viết test migration trên PostgreSQL thật trong container.

### 3.2. Google OAuth tại Nest

- [ ] Validate đủ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI và environment lúc bootstrap.
- [ ] Chỉ dùng scope tối thiểu `openid email profile` và `prompt=select_account`.
- [ ] Tạo/lưu hash `state`, hash `nonce` và PKCE verifier được mã hóa authenticated encryption.
- [ ] Exchange callback phải kiểm tra transaction còn hạn, đúng environment, chưa consume và chưa vượt `max_attempts`.
- [ ] Verify `iss`, `aud`, `exp`, `nonce`, `email_verified=true` và `google_sub`.
- [ ] Không dùng `login_hint` hoặc email nhập tay để cấp quyền.
- [ ] Sync email theo `google_sub`; xử lý unique conflict graceful.
- [ ] `access_denied` và mọi OAuth failure dùng response generic.

### 3.3. Session và role/status

- [ ] Tạo access session 15 phút và refresh session 30 ngày dạng opaque.
- [ ] Chỉ lưu hash token; rotation và reuse detection revoke toàn bộ family.
- [ ] Logout revoke session/family; status `SUSPENDED/DELETED` revoke session atomic.
- [ ] Kiểm tra account status trên mọi authenticated request; mọi failure session trả `401` cùng shape.
- [ ] Parse `AUTH_ADMIN_GOOGLE_SUBS` mỗi lần login; promote `USER -> ADMIN` atomic và audit.
- [ ] Không tự demote khi allowlist bị rút; cung cấp tooling explicit demotion có actor/reason audit.
- [ ] Status `DELETED` ẩn user-facing, giữ resource product và hỗ trợ admin audit hạn chế.

### 3.4. Next BFF

- [ ] Public routes: `/auth/google/start`, `/auth/google/callback`, `/auth/refresh`, `/auth/logout`, `/auth/me`.
- [ ] Callback exchange ngay rồi redirect URL sạch; không nhận redirect đích tùy ý.
- [ ] Set cookie `HttpOnly`, `Secure`, `SameSite=Lax`, host-only; local có cấu hình `Secure=false` riêng.
- [ ] BFF forward access token server-side tới Nest qua internal DNS và mTLS; refresh token chỉ dùng route refresh.
- [ ] Legacy client owner-identity header seam đã bị loại bỏ; BFF chỉ forward access token server-side và không cache user data SSR giữa các user.
- [ ] Error response allowlist gồm `code`, `message`, `retryable`, `traceId` nếu contract yêu cầu; không chuyển tiếp provider detail.

### 3.5. mTLS và network

- [ ] Cấp certificate cho web-bff bằng internal CA/cert-manager.
- [ ] Nest trust đúng CA, kiểm chain, expiry, SAN/SPIFFE identity và route scope.
- [ ] Internal routes không đi qua public ingress; thêm NetworkPolicy.
- [ ] Certificate rotation không cần đổi code hoặc đưa private key vào image.
- [ ] Reject certificate thiếu, hết hạn, sai CA hoặc sai service identity.
- [ ] CI dùng CA/certificate fixture riêng; không dùng cert dev/prod.

### 3.6. CSRF, rate-limit và logging

- [ ] Mutation BFF kiểm `Origin` allowlist cố định; thiếu Origin thì kiểm `Referer`; thiếu cả hai trả `403` generic.
- [ ] Kiểm `Sec-Fetch-Site` khi header xuất hiện; OAuth callback không trở thành bypass CSRF toàn cục.
- [ ] Traefik giới hạn start 10/phút/IP, burst 3; callback 20/phút/IP.
- [ ] OAuth transaction tăng `attempt_count` atomic, `max_attempts` 3–5.
- [ ] Chỉ tin forwarded IP từ proxy allowlist; không tin header client gửi trực tiếp.
- [ ] Log sanitized event; cấm authorization code, token, PKCE verifier, cookie, raw email/state/origin/referrer.

### 3.7. Ownership và queue cancellation

- [ ] Nest đổi status trước và ghi cancellation command/outbox trong transaction sở hữu identity.
- [ ] Queue owner chuyển `PENDING/CLAIMABLE -> CANCELLED`; job `RUNNING` nhận cancellation marker/attempt fence.
- [ ] Go worker không query `auth.users` và không tạo cross-schema transaction.
- [ ] Conditional write trước persist kiểm job chưa cancel, attempt fence còn khớp và cancellation đã áp dụng.
- [ ] Job bị cancel bỏ kết quả và không retry; `COMPLETED` giữ nguyên.
- [ ] Cancellation và audit event idempotent.

## 4. Cấu hình theo môi trường

| Môi trường | Identity mode | OAuth provider | Redirect URI | Ghi chú |
| --- | --- | --- | --- | --- |
| Local | Stub chỉ khi bật explicit hoặc Google thật | Có thể fake/Google | `http://localhost:3000/auth/google/callback` | Không dùng làm bằng chứng production |
| CI | Fixture stub/fake OIDC | Fake deterministic | Fixture | Không chứa credential thật |
| Shared dev | Google thật | Google | `https://learningplatform-dev.sirobabycloud.io.vn/auth/google/callback` | Kiểm topology BFF/cookie/mTLS |
| Production | Google auth-only | Google | URI allowlist exact | Fail-closed nếu stub |

Điều kiện chung:

- [ ] Client ID/secret tách theo environment; secret chỉ ở Nest Secret/SSM.
- [ ] Google Console allowlist exact, không wildcard.
- [ ] Legacy client owner-identity header và `PHASE0_DEV_OWNER_ID` không còn trong runtime contract ở mọi environment.
- [ ] `IDENTITY_MODE=stub` không bật mặc định; chỉ dùng tường minh cho fixture hoặc bypass mTLS nội bộ đã kiểm soát. Resource request vẫn yêu cầu bearer session đã xác thực; `NODE_ENV=production` + stub phải fail-closed.

## 5. Test matrix

### 5.1. Unit và contract

- [ ] Verify claim hợp lệ và từng lỗi `iss`, `aud`, `exp`, `nonce`, `email_verified`, `google_sub`.
- [ ] State mismatch, state reuse, transaction expired, max attempts và callback đồng thời.
- [ ] PKCE exchange và giải mã verifier; key sai hoặc ciphertext bị sửa phải fail-closed.
- [ ] Session expiry, rotation, reuse detection, logout, suspend/delete revoke.
- [ ] Role promotion, explicit demotion audit, status override role.
- [ ] Generic error shape và không rò rỉ provider detail.

### 5.2. Integration

- [ ] Fake OIDC mô phỏng authorization redirect, token exchange và JWKS/signature.
- [ ] PostgreSQL thật kiểm migration, unique/index/check constraint và transaction atomic.
- [ ] mTLS fixture kiểm CA, SAN/SPIFFE, expiry, scope và certificate rotation.
- [ ] BFF kiểm host-only cookie, callback URL sạch và bearer forwarding.
- [ ] Ownership/IDOR: user không đọc resource của user khác hoặc resource của deleted user.
- [ ] Presigned URL bị từ chối cho deleted user.

### 5.3. Smoke và rollout

- [ ] Local Google login: user mới, login lại, onboarding skip/complete.
- [ ] Shared dev Google login với browser thật, redirect, cookie, BFF và mTLS.
- [ ] Production smoke bằng account/test data riêng, có cleanup rõ ràng.
- [ ] Kiểm readiness/health sau migration và sau mỗi rollout.
- [ ] Kiểm không có raw token/code/PII trong application log, ingress log và tracing.

## 6. Rollout gate

1. [ ] Migration additive đã pass và readiness chạy sau migration.
2. [ ] Auth code, mTLS certificate, OAuth config và secret đã có trước khi bật login.
3. [ ] Contract/readiness/security checks pass.
4. [ ] Local Google flow pass.
5. [ ] Shared dev Google flow pass.
6. [ ] Production auth-only pass; không có fallback stub.
7. [ ] Theo dõi login failure, session revoke, callback latency và rate-limit.
8. [ ] Xác nhận không còn legacy owner-identity contract; stub chỉ còn ở fixture hoặc bypass mTLS nội bộ được kiểm soát và không trở thành fallback cho resource request.

## 7. Rủi ro và follow-up

| Rủi ro | Biện pháp | Chủ đề follow-up |
| --- | --- | --- |
| Google outage | Generic failure, không fallback identity, smoke lại khi provider hồi phục | Vận hành provider |
| One-way admin promotion | Offboarding xóa allowlist + demotion có audit | #109 admin workflow |
| Cookie/BFF topology sai | Shared dev browser smoke và mTLS contract | BFF operations |
| Legacy owner rows | Không backfill; giữ ownership filter và cleanup riêng | Data retention |
| Transaction table phình | CLI cleanup batch, CronJob `Forbid`, giữ audit 24–72 giờ | Operations |
| Rate-limit nhiều replica | Traefik trước; Redis chỉ khi cần cluster-wide accuracy | Platform backlog |

## 8. Bằng chứng bắt buộc trước khi đóng issue

- [ ] Pull request chứa migration, Nest module, Next BFF, test và config đã review.
- [ ] CI xanh với fake OIDC, PostgreSQL và mTLS fixture.
- [ ] Shared dev smoke có log/ảnh chụp đã sanitize.
- [ ] Production smoke pass sau rollout, có kiểm tra readiness và cookie/BFF.
- [ ] Issue #108 có comment `HOÀN THÀNH` nêu PR/commit, lệnh kiểm tra, evidence và giới hạn còn lại.
- [ ] Project chuyển `Done` và issue chỉ đóng sau commit/push, Actions pass và post-push verification.
