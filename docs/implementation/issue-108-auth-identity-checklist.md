# Issue #108 — Checklist triển khai Auth/Identity

## 1. Mục đích

Checklist này chuyển các quyết định trong [ADR-0024](../adr/0024-google-oauth-bff-identity.md) thành các lát implementation và bằng chứng kiểm chứng. Tài liệu không thay thế GitHub Issue #108 và không coi hạng mục là hoàn tất trước khi có test, rollout và evidence tương ứng.

## 2. Phạm vi triển khai

| Nhóm | Kết quả cần có | Trạng thái |
| --- | --- | --- |
| Identity | Google OAuth-only, `google_sub` canonical | Đã có implementation; claim và flow được kiểm chứng bằng unit/E2E |
| BFF | Next start/callback/refresh/logout/me, host-only cookies | Đã kiểm chứng bằng runtime HTTPS/mTLS fixture |
| Nest | Internal auth contract, claim verification, session service | Đã kiểm chứng bằng unit, PostgreSQL integration và HTTP E2E |
| Persistence | `auth.users`, `user_profiles`, `sessions`, `oauth_transactions` | Đã kiểm chứng trên PostgreSQL thật trong container |
| Security | mTLS, CSRF, rate-limit, generic errors, no secret logging | Local/fixture checks pass; shared-dev rollout và browser smoke có bằng chứng từ #124; production chưa áp dụng vì chưa có môi trường |
| Ownership | Production auth-only, stub chỉ local/test | Guard và deleted-user/presigned checks pass; shared-dev đã kiểm tra post-rollout; production N/A vì chưa có môi trường |
| Async boundary | Cancellation command/outbox và attempt fence | Outbox/ownership checks đã có; stale OAuth lease fence đã bổ sung trong #125 |
| Verification | Fake OIDC CI, PostgreSQL/mTLS fixture, shared-dev/production smoke | Deterministic local checks pass; shared-dev có evidence từ #124; production N/A vì repository chưa có production environment |

## 3. Lát implementation

### 3.1. Persistence và migration

- [x] Tạo migration additive cho schema `auth` và các bảng `users`, `user_profiles`, `sessions`, `oauth_transactions`.
- [x] Bổ sung unique/index/check constraint đã nêu trong ADR-0024.
- [x] Bảo đảm migration runner chạy trước readiness và dùng advisory lock.
- [x] Không backfill `owner_id` legacy, không thêm FK trực tiếp từ Document/Quiz/Attempt.
- [x] Kiểm tra rollback code tương thích schema đã migrate; không drop bảng auth khi rollback.
- [x] Viết test migration trên PostgreSQL thật trong container (`auth-identity.migration.spec.ts`, `auth.persistence.integration.spec.ts`).

### 3.2. Google OAuth tại Nest

- [x] Validate đủ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI và environment lúc bootstrap.
- [x] Chỉ dùng scope tối thiểu `openid email profile`, `access_type=online` và `prompt=select_account`.
- [x] Tạo/lưu hash `state`, hash `nonce` và PKCE verifier được mã hóa authenticated encryption.
- [x] Exchange callback kiểm tra transaction còn hạn, đúng environment, chưa consume, lease stale có thể reclaim và không vượt `max_attempts`.
- [x] Verify `iss`, `aud`, `exp`, `nonce`, `email_verified=true` và `google_sub`.
- [x] Không dùng `login_hint` hoặc email nhập tay để cấp quyền.
- [ ] Sync email theo `google_sub`; xử lý unique conflict graceful.
- [x] `access_denied` và mọi OAuth failure dùng response generic.

### 3.3. Session và role/status

- [x] Tạo access session 15 phút và refresh session 30 ngày dạng opaque.
- [x] Chỉ lưu hash token; rotation và reuse detection revoke toàn bộ family.
- [x] Logout revoke session/family; status `SUSPENDED/DELETED` revoke session atomic.
- [x] Kiểm tra account status trên mọi authenticated request; mọi failure session trả `401` cùng shape.
- [x] Parse `AUTH_ADMIN_GOOGLE_SUBS` mỗi lần login; promote `USER -> ADMIN` atomic và audit seam.
- [ ] Không tự demote khi allowlist bị rút; cung cấp tooling explicit demotion có actor/reason audit.
- [x] Status `DELETED` ẩn user-facing, giữ resource product và hỗ trợ admin audit hạn chế.

### 3.4. Next BFF

- [x] Public routes: `/auth/google/start`, `/auth/google/callback`, `/auth/refresh`, `/auth/logout`, `/auth/me`.
- [x] Callback exchange ngay rồi redirect URL sạch; không nhận redirect đích tùy ý.
- [x] Set cookie `HttpOnly`, `Secure`, `SameSite=Lax`, host-only; local có cấu hình `Secure=false` riêng.
- [x] BFF forward access token server-side tới Nest qua internal DNS và mTLS; refresh token chỉ dùng route refresh.
- [x] Legacy client owner-identity header seam đã bị loại bỏ; BFF chỉ forward access token server-side và không cache user data SSR giữa các user.
- [x] Error response dùng shape generic allowlist; không chuyển tiếp provider detail.

### 3.5. mTLS và network

- [x] Cấp certificate cho web-bff bằng internal CA/cert-manager.
- [x] Nest trust đúng CA, kiểm chain, expiry, SAN/SPIFFE identity và route scope.
- [x] Internal routes không đi qua public ingress; thêm NetworkPolicy.
- [x] Certificate rotation không cần đổi code hoặc đưa private key vào image.
- [x] Reject certificate thiếu, hết hạn, sai CA hoặc sai service identity.
- [x] CI dùng CA/certificate fixture riêng; không dùng cert dev/prod.

### 3.6. CSRF, rate-limit và logging

- [x] Mutation BFF kiểm `Origin` allowlist cố định; thiếu Origin thì kiểm `Referer`; thiếu cả hai trả `403` generic.
- [x] Kiểm `Sec-Fetch-Site` khi header xuất hiện; OAuth callback không trở thành bypass CSRF toàn cục.
- [x] Traefik giới hạn start 10/phút/IP, burst 3; callback 20/phút/IP.
- [x] OAuth transaction tăng `attempt_count` atomic, `max_attempts` 3–5 và stale lease có fence.
- [x] Chỉ tin forwarded IP từ proxy allowlist; không tin header client gửi trực tiếp.
- [x] Log sanitized event; cấm authorization code, token, PKCE verifier, cookie, raw email/state/origin/referrer.

### 3.7. Ownership và queue cancellation

- [x] Nest đổi status trước và ghi cancellation command/outbox trong transaction sở hữu identity.
- [x] Queue owner chuyển `PENDING/CLAIMABLE -> CANCELLED`; job `RUNNING` nhận cancellation marker/attempt fence.
- [x] Go worker không query `auth.users` và không tạo cross-schema transaction.
- [x] Conditional write trước persist kiểm job chưa cancel, attempt fence còn khớp và cancellation đã áp dụng.
- [x] Job bị cancel bỏ kết quả và không retry; `COMPLETED` giữ nguyên.
- [x] Cancellation và audit event idempotent.

## 4. Cấu hình theo môi trường

| Môi trường | Identity mode | OAuth provider | Redirect URI | Ghi chú |
| --- | --- | --- | --- | --- |
| Local | Stub chỉ khi bật explicit hoặc Google thật | Có thể fake/Google | `http://localhost:3000/auth/google/callback` | Không dùng làm bằng chứng production |
| CI | Fixture stub/fake OIDC | Fake deterministic | Fixture | Không chứa credential thật |
| Shared dev | Google thật | Google | `https://learningplatform-dev.sirobabycloud.io.vn/auth/google/callback` | Kiểm topology BFF/cookie/mTLS |
| Production | Google auth-only | Google | URI allowlist exact | Fail-closed nếu stub |

Điều kiện chung:

- [x] Client ID/secret tách theo environment; secret chỉ ở Nest Secret/SSM.
- [x] Google Console allowlist exact, không wildcard.
- [x] Legacy client owner-identity header và `PHASE0_DEV_OWNER_ID` không còn trong runtime contract ở mọi environment.
- [x] `IDENTITY_MODE=stub` không bật mặc định; chỉ dùng tường minh cho fixture hoặc bypass mTLS nội bộ đã kiểm soát. Resource request vẫn yêu cầu bearer session đã xác thực; `NODE_ENV=production` + stub phải fail-closed.

## 5. Test matrix

### 5.1. Unit và contract

- [x] Verify claim hợp lệ và từng lỗi `iss`, `aud`, `exp`, `nonce`, `email_verified`, `google_sub`.
- [x] State mismatch, state reuse, transaction expired, max attempts, stale lease reclaim và callback đồng thời.
- [x] PKCE exchange và giải mã verifier; key sai hoặc ciphertext bị sửa phải fail-closed.
- [x] Session expiry, rotation, reuse detection, logout, suspend/delete revoke.
- [ ] Role promotion, explicit demotion audit, status override role (demotion tooling thuộc #109).
- [x] Generic error shape và không rò rỉ provider detail.

### 5.2. Integration

- [x] Fake OIDC mô phỏng authorization redirect, token exchange, `access_type=online`, `prompt=select_account` và JWKS/signature.
- [x] PostgreSQL thật kiểm migration, unique/index/check constraint và transaction atomic.
- [x] mTLS fixture kiểm CA, SAN/SPIFFE, expiry, scope và certificate rotation.
- [x] BFF kiểm host-only cookie, callback URL sạch, bearer forwarding, refresh và logout qua HTTPS/mTLS runtime fixture.
- [x] Ownership/IDOR: user không đọc resource của user khác hoặc resource của deleted user.
- [x] Presigned URL bị từ chối cho deleted user.

### 5.3. Smoke và rollout

- [ ] Local Google login thật: browser smoke không chạy lại trong #125; HTTP flow với fake OIDC deterministic đã pass. Cần chạy lại khi cần bằng chứng browser local.
- [x] Shared dev post-rollout browser smoke: đã kiểm tra `/home`, `/settings`, `/library`, `/upload`, redirect `/login` khi đã đăng nhập, refresh và invalid route trong [comment #124](https://github.com/SiroBaby/LearningPlatform/issues/124#issuecomment-5498106985). Fresh Google consent/login không được suy diễn từ evidence này.
- [x] Production smoke: `N/A - repository hiện chưa có production environment`, inventory production hoặc workflow triển khai production; không có account/test data production để báo cáo.
- [x] Kiểm readiness/health sau rollout shared-dev: workflow `Deploy development VPS` thành công và web rollout `ready=1`, `replicas=1` theo [comment rollout #124](https://github.com/SiroBaby/LearningPlatform/issues/124#issuecomment-5498048185). Migration/readiness contract được kiểm trong local/infra validation.
- [ ] Kiểm không có raw token/code/PII trong application log, ingress log và tracing: local test chỉ kiểm application redaction; chưa có evidence đầy đủ từ ingress/tracing shared-dev.

### 5.4. Bằng chứng đã chạy cho #125

- Ngày ghi nhận evidence: `2026-09-02`; source base SHA `5fc3ac6` và các thay đổi chưa commit trong working tree của #125. Không coi SHA base là SHA đã chứa các thay đổi này.
- Backend: `npm ci`, `node ../deploy/dev/audit-high.js`, `npm audit`, `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`, `npx tsc -p tsconfig.spec.json --noEmit` đều pass; full unit là `81 suites/420 tests`, E2E là `2 suites/5 tests`.
- Auth regression hẹp: `npm test -- --runInBand src/test-support/test-db.spec.ts src/modules/auth/auth-identity.migration.spec.ts src/modules/auth/auth.persistence.integration.spec.ts` pass với `3 suites/12 tests`; helper test DB khôi phục `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` khi migration setup lỗi.
- `app/test/fake-google-oidc-provider.spec.ts` và các auth unit/integration/E2E pass với fake OIDC deterministic, PostgreSQL thật trong container và regression stale lease/attempt fence.
- Web: `npm ci`, audit, lint, `node --test $(rg --files src | rg '\.test\.mjs$' | sort)` (`80 tests`) và build pass; `npm run test:runtime` cũng pass. Runtime HTTPS fixture kiểm client certificate, SAN/SPIFFE `web-bff`, route scope, unauthorized response, callback redirect sạch, cookie `Secure`/`HttpOnly`/`SameSite=Lax`/host-only/`Path=/`, bearer forwarding, refresh và logout.
- Infrastructure: `bash infra/scripts/validate.sh` pass (`failed=0`); các fixture failure trong output là failure có chủ đích và được harness xác nhận; `git diff --check` pass.
- Shared dev evidence từ #124: [workflow run 33536868497](https://github.com/SiroBaby/LearningPlatform/actions/runs/33536868497), SHA triển khai `8f4b93a864d50e0c78f81e0e355198bab6e420d2`, kết quả SUCCESS; web/API/worker rollout và legacy env contract được kiểm tra, không ghi secret/token/private key. Browser smoke được ghi tại [comment #124](https://github.com/SiroBaby/LearningPlatform/issues/124#issuecomment-5498106985).
- Source/config readiness: local infra validation kiểm mTLS route/config contract và expected SPIFFE/path; shared-dev workflow kiểm rollout/readiness và không còn `PHASE0_API_BASE_URL`/`PHASE0_DEV_OWNER_ID` trong Deployment `web`. Giá trị secret, token, certificate private key và dữ liệu account không được ghi vào tài liệu.
- Production: `N/A - repository hiện chưa có production environment`; không có production account, cookie, log hoặc rollout evidence để báo cáo và không đánh dấu pass giả định.

## 6. Rollout gate

1. [x] Migration additive đã pass trong PostgreSQL container; readiness/migration contract được kiểm bằng test backend và `bash infra/scripts/validate.sh`.
2. [x] Auth code, mTLS certificate contract, OAuth config contract và secret wiring đã được kiểm ở source/infra; shared-dev rollout #124 thành công. Không ghi giá trị secret.
3. [x] Contract/readiness/security checks local pass; shared-dev rollout/readiness có evidence #124.
4. [ ] Local Google flow thật chưa chạy lại trong #125; fake OIDC deterministic đã pass.
5. [x] Shared-dev post-rollout browser/session smoke pass theo evidence #124; fresh Google consent/login chưa được suy diễn.
6. [x] Production auth-only: `N/A - repository hiện chưa có production environment`; không có fallback production nào được báo cáo.
7. [ ] Chưa có evidence đầy đủ cho theo dõi vận hành dài hạn (login failure, session revoke, callback latency, rate-limit) trong task này.
8. [x] Legacy owner-identity contract đã được kiểm tra không còn trong shared-dev Deployment `web`; stub chỉ còn cho fixture/local explicit và không phải fallback resource.

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

- [ ] Pull request chứa test/config/checklist #125 đã review; chưa commit/push trong evidence hiện tại.
- [x] Deterministic local CI-equivalent pass với fake OIDC, PostgreSQL và mTLS fixture; GitHub Actions của PR #125 chưa chạy vì chưa publish branch.
- [x] Shared dev smoke có bằng chứng sanitized trong [comment #124](https://github.com/SiroBaby/LearningPlatform/issues/124#issuecomment-5498106985) và rollout [run 33536868497](https://github.com/SiroBaby/LearningPlatform/actions/runs/33536868497).
- [x] Production smoke: `N/A - repository hiện chưa có production environment`; source/config readiness đã kiểm ở local/infra và không có account production để smoke.
- [ ] Issue #108 có comment `HOÀN THÀNH` nêu PR/commit, lệnh kiểm tra, evidence và giới hạn còn lại.
- [ ] Project chuyển `Done` và issue chỉ đóng sau commit/push, Actions pass và post-push verification.
