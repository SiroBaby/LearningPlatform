# RUNBOOK credit reconciler trên dev K3s (#275)

Tài liệu này dành cho owner khi bật, kiểm tra hoặc tắt credit reconciler (bộ đối
soát credit) trên dev. Reconciler ghi vào sổ credit (`course.credit_ledger_entries`)
và ví (`course.owner_credit_wallets`), nên mọi bước bên dưới đều có cách kiểm tra
và cách quay lui.

## 1. Reconciler là gì và vì sao cần

- **Dùng để làm gì**: mỗi lần xử lý một Document, hệ thống giữ chỗ credit
  (`RESERVE`). Thông thường kết quả của Go worker quay về qua return relay và
  `settleReservation` chốt khoản giữ chỗ (`SETTLE` phần đã dùng, `RELEASE` phần
  dư, hoặc `HOLD` phần chưa rõ). Có những trường hợp **không bao giờ có kết quả**
  để chốt, khiến `reserved_credits` bị khóa vĩnh viễn:
  1. Document bị xóa khi job đang chạy: Go bị chặn bởi dấu hủy
     (`cancellation_marker_id`) nên không ghi kết quả.
  2. Job còn `PENDING`, chưa bao giờ được claim, rồi Document bị xóa.
  3. Credit được giữ ngay sau khi probe/extract xong nhưng job `FULL_PIPELINE`
     chưa được chuyển tiếp (forward) thì Document đã bị xóa.
  4. Tài khoản bị thu hồi quyền (`account_access_revocations`) giữa chừng.
  5. Document đã sang attempt mới (retry) trong khi attempt cũ chưa được chốt.
- **Cách hoạt động**: cứ mỗi 5 phút, một vòng lặp trong container `worker` (Node,
  `WORKER_EXECUTION_MODE=relay-only`) quét các `RESERVE` đã quá 30 phút mà chưa có
  khóa `settle:{jobId}:{processingAttempt}`. Với từng khoản, nó khóa Document rồi
  ví (đúng thứ tự Document -> wallet), đọc bằng chứng từ phía AI qua port
  `PROCESSING_SETTLEMENT_FACTS`, và luôn chốt bằng `settleReservation` (không viết
  tay riêng `release:`), nên nếu kết quả Go đến muộn thì relay chỉ nhận
  `ALREADY_SETTLED` và ghi warn `content.settlement.after_reconcile`.
- **Quy tắc an toàn**: khi không biết chắc đã tiêu bao nhiêu thì **HOLD**, không
  RELEASE.
- **Auto-release HOLD**: một `HOLD` sau 24 giờ chưa được ai xử lý sẽ được trả về ví
  (`hold-release:{jobId}:{processingAttempt}`, loại `RELEASE`): chỉ cộng
  `available_credits`, Document `HELD` chuyển `SETTLED`. Đây là quyết định đã được
  owner duyệt.
- **Vị trí code**: `app/src/modules/content/credit-reconciler.service.ts`,
  `app/src/modules/content/repositories/credit-reconciliation.repository.ts`,
  `app/src/worker/credit-reconciler-runner.service.ts`. Mỗi vòng giữ advisory lock
  `credit-reconciler` nên nhiều pod hoặc nhiều lần chạy không ghi trùng.

## 2. Cờ và tham số

Các giá trị là manifest literal trong `infra/k8s/apps.yaml.j2` (container `worker`),
không lấy từ SSM hay ExternalSecret.

| Biến môi trường | Nguồn | Mặc định template | Dev hiện tại |
| --- | --- | --- | --- |
| `CREDIT_RECONCILER_ENABLED` | Ansible `credit_reconciler_enabled` | `false` | `true` |
| `CREDIT_RECONCILER_DRY_RUN` | Ansible `credit_reconciler_dry_run` | `true` | `false` |
| `CREDIT_RECONCILER_INTERVAL_MS` | literal | `300000` (5 phút) | như mặc định |
| `CREDIT_RECONCILER_ORPHAN_GRACE_MS` | literal | `1800000` (30 phút, tối thiểu 900000) | như mặc định |
| `CREDIT_RECONCILER_HELD_RELEASE_AFTER_MS` | literal | `86400000` (24 giờ, tối thiểu 3600000) | như mặc định |
| `CREDIT_RECONCILER_BATCH_SIZE` | literal | `50` | như mặc định |

- `ENABLED=false`: không có gì chạy, chỉ log `credit.reconcile.disabled` lúc khởi động.
- `ENABLED=true`, `DRY_RUN=true`: tính và log quyết định (`dryRun: true`) nhưng
  mọi giao dịch đều rollback, không ghi sổ, không auto-release HOLD.
- `ENABLED=true`, `DRY_RUN=false`: ghi thật.
- Giá trị tuning sai (dưới mức sàn, không phải số nguyên) làm worker fail ngay lúc
  khởi động khi reconciler bật; khi tắt thì không ảnh hưởng.

## 3. Quyết định cho từng khoản giữ chỗ

Reconciler chỉ động vào khoản **không còn đường nào khác để được chốt**:

| Nhóm (`category`) | Điều kiện |
| --- | --- |
| `DELETED` | Document `DELETING` |
| `SUPERSEDED` | `documents.processing_attempt` lớn hơn attempt của khoản giữ chỗ |
| `TERMINAL_UNSETTLED` | Document `READY`/`FAILED` đúng attempt nhưng chưa có `settle:` |
| `REVOKED` | Document `PROCESSING`, job bị hủy do thu hồi tài khoản |
| `DOCUMENT_MISSING` | Hàng Document không còn |

Document `PROCESSING` có job còn sống, hoặc đã reserve nhưng chưa forward, **không**
bao giờ bị động tới. Khoản có kết quả đã ghi nhưng relay chưa publish cũng bị bỏ
qua (`skippedInFlight`) để relay tự chốt. Ngoài ra bằng chứng phải đã cũ hơn
`ORPHAN_GRACE_MS` (tính từ thời điểm hủy/hoàn tất job, hoặc `updated_at` của Document).

Thứ tự bằng chứng (`evidence`):

1. `RESULT_PAYLOAD`: kết quả đã publish trong `ai.outbox`. Có `usage` thì tính như
   relay; không có `usage` (trước #273) thì chỉ release hết khi FAILED trước mọi
   lần gọi provider, còn lại HOLD hết.
2. `NO_JOB`: không có hàng job `FULL_PIPELINE` với id đó, chưa gọi ai, release hết.
3. `NEVER_CLAIMED`: `attempts` nhỏ hơn `processing_attempt`, chưa từng claim, release hết.
4. `USAGE_RECORDS`: cộng token trong `ai.provider_usage_records` (`request_key LIKE
   'go-llm:%'`) và giây STT trong `ai.media_stt_chunk_results`. HOLD phần còn lại
   khi có lần gọi chưa rõ kết quả (`UNAVAILABLE`, không tính dòng `cached`), có
   STT `uncertain_ms`, hàng job cũ chưa ghi `processing_attempt`, job media bị hủy
   sau khi đã claim (STT có thể đang bay mà chưa có checkpoint), hoặc không có bằng
   chứng nào trong khi attempt không xác định được. Ngược lại settle phần đã dùng
   và release phần dư.

Hàng Document chỉ được cập nhật (`budget_status` `SETTLED`/`HELD`, `settled_credits`)
khi `processing_attempt` của nó đúng bằng attempt của khoản giữ chỗ. Reconciler
không bao giờ đổi `status` của Document.

## 4. Bật trên dev và kiểm tra

Thay đổi này bật thật ngay trên dev (`credit_reconciler_enabled: true`,
`credit_reconciler_dry_run: false`) theo quyết định của owner. Nếu muốn quan sát
trước, đặt `credit_reconciler_dry_run: true`, rollout worker, xem log, rồi đổi lại.

1. Rollout worker (`deployment_targets` có `worker`) như quy trình deploy dev thông thường.
2. Xác nhận cờ đã lên pod:

   ```bash
   sudo k3s kubectl -n learning-platform-dev get deployment/worker \
     -o jsonpath='{range .spec.template.spec.containers[?(@.name=="worker")].env[*]}{.name}={.value}{"\n"}{end}' \
     | grep CREDIT_RECONCILER
   ```

3. Xác nhận vòng lặp đã bật và chạy:

   ```bash
   sudo k3s kubectl -n learning-platform-dev logs deployment/worker -c worker --since=15m \
     | grep -E 'credit\.(reconcile|hold)\.'
   ```

   Cần thấy `credit.reconcile.enabled` (kèm `mode`: `apply` hoặc `dry-run`), rồi
   `credit.reconcile.completed` mỗi khoảng 5 phút với các số đếm
   `scannedReservations`, `settledCount`, `releasedCount`, `heldCount`,
   `releasedCredits`, `heldCredits`, `skippedInFlight`, `skippedLocked`,
   `skippedLive`, `heldScanned`, `heldReleasedCount`, `heldReleasedCredits`.
   Mỗi khoản được chốt có một dòng `credit.reconcile.reservation_resolved`
   (`documentId`, `jobId`, `category`, `evidence`, `decision`, `reservedCredits`,
   `knownActualCredits`, `heldCredits`, `dryRun`).
4. Kiểm tra bằng dữ liệu (chỉ đọc). Khoản giữ chỗ còn mở quá hạn, kỳ vọng rỗng
   sau một vài vòng, trừ các khoản vẫn đang chạy hợp lệ:

   ```sql
   SELECT r.job_id, r.job_attempt, r.credits, r.created_at
   FROM course.credit_ledger_entries r
   WHERE r.entry_type = 'RESERVE' AND r.created_at < now() - interval '30 minutes'
     AND NOT EXISTS (SELECT 1 FROM course.credit_ledger_entries s
                     WHERE s.business_key = 'settle:' || r.job_id || ':' || r.job_attempt)
   ORDER BY r.created_at;
   ```

   Với từng dòng còn lại, tra Document (`course.documents.full_pipeline_job_id`):
   `PROCESSING` có job đang chạy là bình thường.
5. Kiểm tra HOLD đã tự trả sau 24 giờ:

   ```sql
   SELECT h.job_id, h.job_attempt, h.credits, h.created_at,
          EXISTS (SELECT 1 FROM course.credit_ledger_entries x
                  WHERE x.business_key = 'hold-release:' || h.job_id || ':' || h.job_attempt) AS released
   FROM course.credit_ledger_entries h WHERE h.entry_type = 'HOLD' ORDER BY h.created_at DESC LIMIT 20;
   ```

6. Thử nghiệm đầu-cuối (dev, có dữ liệu test): tạo Document, bắt đầu xử lý, xóa khi
   job đang chạy, đợi hết 30 phút ngưỡng chờ rồi một vòng reconciler; ví phải có
   `reserved_credits = 0` và sổ có đủ `settle`/`release`/`hold` cho khóa đó.

Ghi bằng chứng (log, kết quả SQL, giới hạn) vào ticket #275 theo quy trình GitHub Project.

## 5. Tắt nhanh và quay lui

- **Về report-only**: đặt `credit_reconciler_dry_run: true` trong
  `infra/ansible/vars/dev.yml` rồi rollout worker. Từ đó không còn ghi sổ.
- **Tắt hẳn**: đặt `credit_reconciler_enabled: false` rồi rollout worker.
- **Khẩn cấp không qua Ansible**: không sửa tay Deployment (lần rollout sau sẽ ghi
  đè). Nếu bắt buộc, scale `worker` về 0 sẽ dừng cả relay, nên chỉ làm khi đã
  thống nhất và nhớ scale lại.
- **Các ghi đã thực hiện không tự đảo**: `SETTLE`/`RELEASE`/`HOLD`/`hold-release` là
  bút toán sổ cái, idempotent theo `business_key`. Muốn sửa một khoản sai phải
  thêm bút toán bù có owner duyệt, không xóa hay sửa dòng cũ. Không có migration
  nào đi kèm tính năng này nên không có bước rollback schema.

## 6. Alert (Loki ruler)

Quy tắc nằm trong ConfigMap `learning-platform-loki-alert-rules`, tệp
`credit-reconciler.yaml`, nhóm `learning-platform.credit-reconciler`, chọn log
`{namespace="learning-platform-dev", container="worker"}`.

| Alert | Điều kiện | Cách xử lý |
| --- | --- | --- |
| `CreditReconcileFailed` | có `credit.reconcile.failed` trong 10 phút | Xem trường `stage` (`run`, `reservation`, `hold-release`, `lock-release`) và `jobId`; một khoản lỗi không chặn các khoản khác, nhưng sẽ được thử lại ở vòng sau. |
| `CreditHeldAutoReleaseAbnormal` | tổng `heldReleasedCount` trong 24 giờ lớn hơn 20 | Nhiều HOLD hết hạn bất thường: kiểm tra provider có trả kết quả không rõ nhiều hơn thường lệ. |
| `CreditOrphanReservationsAbnormal` | `releasedCount + heldCount` trong 1 giờ lớn hơn 10 | Có đường hủy/xóa nào đó đang để lại khoản giữ chỗ mồ côi: xem các dòng `reservation_resolved` theo `category`. |
| `CreditReconcileStale` | có sự kiện `credit.reconcile.*` trong 6 giờ nhưng không có `credit.reconcile.completed` trong 15 phút (và không phải trạng thái `disabled`) | Vòng lặp dừng hoặc luôn bị khóa/lỗi; xem log container `worker`. Lỗi liên tiếp làm khoảng chờ tăng gấp đôi tới tối đa 40 phút. |

Các số đếm là trường log có cấu trúc (không có thư viện metrics trong Node), nên
alert đọc trực tiếp log `credit.reconcile.completed`.

## 7. Giới hạn đã biết

- Khoản giữ chỗ mồ côi nhưng Go ghi kết quả muộn: ledger giữ quyết định của
  reconciler; relay chỉ ghi warn `content.settlement.after_reconcile`.
- Purge có thể xóa bằng chứng STT trước khi reconciler đọc: khi đó khoản giữ chỗ bị
  HOLD (an toàn), rồi tự trả sau 24 giờ.
- Dòng `ai.provider_usage_records` với `request_key LIKE 'go-llm:%'` chỉ có khi Go
  worker mới (ghi bản ghi trước mỗi lần gọi LLM) đã chạy attempt đó. Job cũ chưa
  có `processing_attempt` luôn bị HOLD.
- Mỗi vòng xử lý tối đa 20 trang x `BATCH_SIZE` khoản; phần còn lại để vòng sau.
