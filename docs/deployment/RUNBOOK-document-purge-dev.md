# RUNBOOK purge worker trên dev K3s (#159)

Tài liệu này dành cho owner trước và sau khi bật `document_purge_enabled` trên dev.
Purge worker xóa hẳn (hard-delete, xóa vĩnh viễn không khôi phục được) các
phiên bản object mà người dùng đã xóa. Vì thao tác này không hoàn tác được, mọi
bước dưới đây đều cố ý chậm và có điểm kiểm tra.

## 1. Purge worker là gì và chạy ở đâu

- **Dùng để làm gì**: khi người dùng xóa một Document, API ghi một purge manifest
  (danh sách cần xóa vật lý) vào bảng `course.document_purge_manifests`. Purge
  worker đọc bảng này và xóa đúng các phiên bản (`VersionId`) có trong manifest.
- **Cách chạy**: Deployment `document-purge-worker` trong namespace
  `learning-platform-dev`, dùng image backend (`worker_image`), lệnh
  `node dist/worker.js`, `WORKER_EXECUTION_MODE=document-purge`, 1 replica,
  strategy `Recreate`.
- **Quyền**: ServiceAccount (danh tính pod trong cluster) `document-purge-worker`
  không mount token. Pod chỉ đọc Secret `learning-platform-document-purge-runtime`
  (do External Secrets Operator, viết tắt ESO, đồng bộ từ SSM). Secret này chỉ có
  khóa PostgreSQL dùng chung, endpoint/region/tên hai bucket và credential purge
  riêng; không có OpenAI key, credential media-probe hay credential API.
- **Mạng**: NetworkPolicy (luật mạng của pod) chỉ cho đi ra CoreDNS, Squid
  `media-egress-proxy:3128` (đường duy nhất tới S3, chỉ cho
  `.s3.ap-southeast-1.amazonaws.com`) và cổng PostgreSQL
  `media_probe_database_upstream_port` tới địa chỉ public. Không nhận kết nối vào,
  trừ kubelet probe.
- **Health**: `GET /health` cổng `3403`. Server health chỉ khởi động sau khi
  preflight `GetBucketVersioning` của media bucket trả `Enabled`, nên pod chỉ
  Ready khi media bucket đã bật versioning.
- **Cờ**: `document_purge_enabled` trong `infra/ansible/vars/dev.yml`, mặc định
  `false`. Khi `false`, template không render object nào của purge worker.

Nguồn: `infra/k8s/apps.yaml.j2`, `infra/ansible/roles/applications/tasks/document-purge-contract.yml`,
`infra/ansible/roles/external_secrets/templates/external-secrets.yaml.j2`, ADR-0031 §3.

## 2. Điều kiện bắt buộc trước khi bật cờ

Chỉ bật khi **tất cả** đã xong và có bằng chứng ghi vào ticket #159:

1. Media bucket dev có versioning `Enabled` (không phải `Suspended`).
2. Documents bucket (PDF) dev **chưa từng** bật versioning. Nếu đã bật hoặc
   `Suspended`, manifest PDF sẽ vào `DEAD_LETTER` `PURGE_UNVERSIONED_LOCATOR`
   (worker không đoán version vì quyết định Q1 cấm list version).
3. IAM user purge và policy ở mục 3 đã tạo; negative check ở mục 5 đạt.
4. Hai SSM `SecureString` ở mục 4 đã tạo và credential bootstrap ESO đọc được.
5. **Xác nhận (chỉ đọc), không sửa SSM**: NetworkPolicy của purge worker chỉ mở
   cổng `media_probe_database_upstream_port` (hiện là `27158` trong
   `infra/ansible/vars/dev.yml`). Đọc và đối chiếu SSM `/learning-platform/dev/db-port`
   với cổng này, `/learning-platform/dev/db-host` với `media_probe_database_upstream_host`.
   Bình thường hai giá trị đã khớp vì `api`/`worker` dùng chính hai SSM này để vào
   cùng database. **Không sửa** hai SSM này: `api` và `worker` đang chạy đọc chúng,
   đổi sẽ ảnh hưởng runtime hiện có. Nếu lệch, dừng việc bật cờ và mở ticket riêng.
   Ansible không đọc được giá trị SSM nên không tự kiểm được; nếu bật cờ khi lệch,
   pod sẽ restart liên tục ở bước migration.
6. Alert của ticket #222 (Loki ruler, rule `document.purge.dead_lettered`,
   `document.purge.preflight.failed` và rule pod-health cho
   `document-purge-worker`) đã deploy lên dev, và bằng chứng kiểm tra theo mục 8
   (rule `health: ok`, ruler thấy Alertmanager, chưa có lỗi gửi) đã ghi vào ticket.

## 3. Owner tạo IAM user purge

Hạ tầng dev đang dùng static key qua SSM, nên tạo một **IAM user riêng** (ví dụ
`learning-platform-dev-document-purge`), không dùng lại user của API, media-probe
hay full-pipeline.

Tên bucket thật **không có trong repo**; lấy giá trị từ SSM (không dán giá trị vào
ticket công khai nếu coi là nhạy cảm):

| Placeholder | Lấy từ SSM |
| --- | --- |
| `<MEDIA_BUCKET>` | `/learning-platform/dev/object-storage-media-bucket` |
| `<DOCUMENTS_BUCKET>` | `/learning-platform/dev/object-storage-bucket` |

Prefix lấy từ code tạo key (`app/src/modules/content/content.service.ts`):

- Media: `media/<ownerId>/<uuid>.<mp3|mp4>` trong media bucket → prefix `media/*`.
- PDF: `<ownerId>/<uuid>.pdf` ở **gốc** documents bucket, không có prefix riêng →
  resource phải là `<DOCUMENTS_BUCKET>/*`. Muốn hẹp hơn thì phải đổi cách đặt key
  ở API (ngoài phạm vi #159).

Policy tối thiểu (gắn trực tiếp vào IAM user purge):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PurgeMediaVersions",
      "Effect": "Allow",
      "Action": ["s3:DeleteObjectVersion"],
      "Resource": "arn:aws:s3:::<MEDIA_BUCKET>/media/*"
    },
    {
      "Sid": "PurgeDocumentObjects",
      "Effect": "Allow",
      "Action": ["s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<DOCUMENTS_BUCKET>/*"
    },
    {
      "Sid": "ReadBucketVersioning",
      "Effect": "Allow",
      "Action": ["s3:GetBucketVersioning"],
      "Resource": ["arn:aws:s3:::<MEDIA_BUCKET>", "arn:aws:s3:::<DOCUMENTS_BUCKET>"]
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::<MEDIA_BUCKET>",
        "arn:aws:s3:::<MEDIA_BUCKET>/*",
        "arn:aws:s3:::<DOCUMENTS_BUCKET>",
        "arn:aws:s3:::<DOCUMENTS_BUCKET>/*"
      ],
      "Condition": {"Bool": {"aws:SecureTransport": "false"}}
    }
  ]
}
```

Policy này khớp đúng các lệnh S3 mà purger gọi
(`app/src/storage/object-storage-document-purger.ts`):

- Media: chỉ `DeleteObject` **kèm** `VersionId`, cần quyền `s3:DeleteObjectVersion`.
  Không cấp `s3:DeleteObject` trên media bucket: purger không bao giờ xóa media
  theo key (media bucket phải `Enabled`, locator media thiếu `VersionId` vào
  `DEAD_LETTER`), và quyền này chỉ cho phép tạo delete marker (ẩn object hiện tại).
- PDF: `DeleteObject` theo key, chỉ chạy khi documents bucket chưa từng bật
  versioning, cần `s3:DeleteObject`.
- Preflight và nhánh PDF: `GetBucketVersioning` trên hai bucket.

Không cấp: `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`, `s3:ListBucketVersions`,
quyền trên bucket khác, wildcard bucket. Bucket dùng SSE-KMS thì xóa không cần
`kms:Decrypt`.

Tạo access key cho user này, không lưu vào file trong repo, chỉ nhập thẳng vào SSM ở mục 4.

## 4. Owner tạo SSM và cấp quyền cho ESO

1. Tạo hai parameter loại `SecureString` tại region `ap-southeast-1`, đúng path
   (đã khai báo trong `infra/ansible/vars/dev.yml`):
   - `/learning-platform/dev/object-storage-media-purge-access-key`
   - `/learning-platform/dev/object-storage-media-purge-secret-key`
2. Thêm quyền đọc đúng hai ARN này cho IAM user bootstrap ESO (credential nằm
   trong Secret `learning-platform-dev-aws-credentials`). Thay `<ACCOUNT_ID>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadDocumentPurgeCredential",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": [
        "arn:aws:ssm:ap-southeast-1:<ACCOUNT_ID>:parameter/learning-platform/dev/object-storage-media-purge-access-key",
        "arn:aws:ssm:ap-southeast-1:<ACCOUNT_ID>:parameter/learning-platform/dev/object-storage-media-purge-secret-key"
      ]
    }
  ]
}
```

   Nếu hai `SecureString` dùng CMK (khóa KMS tự quản lý) thay vì `aws/ssm`, thêm
   `kms:Decrypt` trên đúng ARN của key đó.
3. Không tạo SSM cho cấu hình không bí mật (batch size, poll, lease, max attempts,
   backoff, proxy URL): các giá trị này là literal trong manifest và có static check.

## 5. Kiểm tra quyền trước khi bật cờ (owner chạy trên máy local)

Dùng AWS CLI với profile tạm của từng credential; không dán key vào terminal được
ghi log hay vào ticket. Key và VersionId dưới đây là giá trị giả, không trỏ tới
object thật, nên lệnh không làm mất dữ liệu kể cả khi quyền bị cấp sai. Ngoại lệ
duy nhất là lệnh xóa **không** kèm `--version-id` ở mục 4: nếu policy cấp sai,
lệnh đó tạo một delete marker (dấu xóa) trên key giả trong media bucket; dữ liệu
thật không mất nhưng phải dọn marker như hướng dẫn ở mục 4.

1. **Negative check media-probe** (bắt buộc): credential media-probe gọi
   `DeleteObjectVersion` phải bị từ chối.

   ```bash
   aws s3api delete-object --profile lp-dev-media-probe --region ap-southeast-1 \
     --bucket <MEDIA_BUCKET> \
     --key media/00000000-0000-0000-0000-000000000000/negative-check.mp4 \
     --version-id negative-check-version
   ```

   Kỳ vọng: `AccessDenied`. Lặp lại với profile full-pipeline và api-media
   (`api-media` cũng không được có `DeleteObjectVersion`). Nếu kết quả là bất kỳ
   thứ gì khác `AccessDenied` (thành công, `NoSuchVersion`, `InvalidArgument`...),
   credential đó đang có quyền xóa: dừng lại và siết IAM.
2. **Purge identity đọc được versioning**:

   ```bash
   aws s3api get-bucket-versioning --profile lp-dev-purge --region ap-southeast-1 --bucket <MEDIA_BUCKET>
   aws s3api get-bucket-versioning --profile lp-dev-purge --region ap-southeast-1 --bucket <DOCUMENTS_BUCKET>
   ```

   Kỳ vọng: media `{"Status": "Enabled"}`; documents trả rỗng (chưa từng bật).
3. **Purge identity không đọc/ghi/list được object**: `get-object`,
   `put-object` và `list-object-versions` bằng profile `lp-dev-purge` đều phải
   `AccessDenied`.
4. **Purge identity không xóa được ngoài prefix cho phép** (bắt buộc): xác nhận
   resource `<MEDIA_BUCKET>/media/*` không bị nới thành `<MEDIA_BUCKET>/*` khi tạo policy.

   ```bash
   aws s3api delete-object --profile lp-dev-purge --region ap-southeast-1 \
     --bucket <MEDIA_BUCKET> \
     --key negative-check/00000000-0000-0000-0000-000000000000/negative-check.mp4 \
     --version-id negative-check-version
   ```

   Kỳ vọng: `AccessDenied` (key nằm ngoài `media/`).

   Tiếp theo, xóa key giả trong `media/` **không** kèm `--version-id`:

   ```bash
   aws s3api delete-object --profile lp-dev-purge --region ap-southeast-1 \
     --bucket <MEDIA_BUCKET> \
     --key media/negative-check/00000000-0000-0000-0000-000000000000/negative-check.mp4
   ```

   Kỳ vọng: `AccessDenied`, vì purge identity không có `s3:DeleteObject` trên
   media bucket. Kết quả khác `AccessDenied` ở một trong hai lệnh nghĩa là policy
   rộng hơn mục 3: dừng lại và sửa IAM.

   Nếu lệnh thứ hai **thành công** (in ra `"DeleteMarker": true`), media bucket
   đang bật versioning nên S3 đã tạo một delete marker trên key giả. Sau khi siết
   IAM, dọn marker bằng credential admin (không dùng `lp-dev-purge`):

   ```bash
   aws s3api list-object-versions --profile <ADMIN_PROFILE> --region ap-southeast-1 \
     --bucket <MEDIA_BUCKET> --prefix media/negative-check/ \
     --query 'DeleteMarkers[].[Key,VersionId]' --output text
   aws s3api delete-object --profile <ADMIN_PROFILE> --region ap-southeast-1 \
     --bucket <MEDIA_BUCKET> \
     --key media/negative-check/00000000-0000-0000-0000-000000000000/negative-check.mp4 \
     --version-id <VERSION_ID_CỦA_MARKER>
   ```

   Chạy lại `list-object-versions` ở trên: kết quả phải rỗng.

## 6. Bật cờ và xác nhận

1. Mở PR đổi đúng một dòng trong `infra/ansible/vars/dev.yml`:
   `document_purge_enabled: true`. Merge vào `develop`.
2. Workflow `Deploy development VPS` tự chạy (classifier chọn mọi runtime khi
   `vars/dev.yml` đổi). Ansible:
   - kiểm `document-purge-contract.yml` (SSM path đúng, proxy bật, port hợp lệ);
   - tạo ExternalSecret `learning-platform-document-purge-runtime` và chờ `Ready`;
   - apply ServiceAccount, NetworkPolicy (gồm rule client trên
     `media-egress-proxy-ingress`), rồi mới tới Deployment `document-purge-worker`;
   - bước `Wait for selected K3s rollouts` chờ thêm `deployment/document-purge-worker`.
3. Xác nhận (chỉ đọc, không in Secret):

   ```bash
   sudo k3s kubectl -n learning-platform-dev rollout status deployment/document-purge-worker --timeout=180s
   sudo k3s kubectl -n learning-platform-dev logs deployment/document-purge-worker --since=10m \
     | grep -E 'document\.purge\.(started|preflight\.failed)'
   ```

   Kỳ vọng: có `document.purge.started`, không có `document.purge.preflight.failed`.
   Pod có thể restart một lần lúc mới tạo nếu kube-router chưa kịp mở luật egress
   cho IP pod (runner migration của Node chưa retry kết nối đầu tiên); restart
   lặp lại nhiều lần là lỗi thật cần xem log.
4. Kiểm tra end-to-end với một Document media thử: xóa qua web, chờ ít nhất
   `presign expiry + 60 giây` (khoảng 6 phút), rồi đọc trạng thái manifest:

   ```sql
   SELECT id, document_id, status, attempts, last_error_code, purged_at, dead_lettered_at
   FROM course.document_purge_manifests
   WHERE document_id = '<document-id>';
   ```

   Kỳ vọng `status = 'COMPLETED'` và có `purged_at`. Owner kiểm thêm bằng
   identity có quyền list (không phải purge): `aws s3api list-object-versions
   --bucket <MEDIA_BUCKET> --prefix <key>` không còn version trong manifest.

## 7. Xử lý manifest `DEAD_LETTER`

`DEAD_LETTER` là trạng thái dừng retry, chờ người xử lý. Worker không tự claim lại.

Liệt kê:

```sql
SELECT id, document_id, attempts, last_error_code, dead_lettered_at
FROM course.document_purge_manifests
WHERE status = 'DEAD_LETTER'
ORDER BY dead_lettered_at;
```

| `last_error_code` | Ý nghĩa | Hành động |
| --- | --- | --- |
| `PURGE_ACCESS_DENIED` | S3 từ chối credential purge | Sửa IAM (mục 3), chạy lại mục 5, rồi đưa lại hàng đợi |
| `PURGE_CONFIGURATION` | Bucket ngoài cấu hình, `NoSuchBucket` hoặc lỗi 4xx khác của S3 | Kiểm tên bucket trong SSM, rồi đưa lại hàng đợi |
| `PURGE_ATTEMPTS_EXHAUSTED` | Lỗi tạm thời lặp đến trần (proxy, mạng, 5xx) | Kiểm `media-egress-proxy` và log, rồi đưa lại hàng đợi |
| `PURGE_ACTIVE_REFERENCE` | Còn Document khác đang dùng cùng bucket + key | **Không** đưa lại hàng đợi; điều tra vì xóa sẽ mất dữ liệu đang dùng |
| `PURGE_UNVERSIONED_LOCATOR` | PDF nằm ở bucket đã bật versioning | Không đưa lại; owner xử lý tay hoặc chờ quyết định mới cho Q2 |
| `PURGE_LOCATORS_UNRESOLVED` | Manifest không có version nào để xóa | Không đưa lại; để orphan scanner (#159 PR-4) xử lý |

Đưa lại hàng đợi **từng manifest một**, chỉ sau khi đã sửa nguyên nhân:

```sql
UPDATE course.document_purge_manifests
SET status = 'PENDING', attempts = 0, next_attempt_at = now(),
    lease_id = NULL, lease_until = NULL, dead_lettered_at = NULL,
    last_error_code = NULL, updated_at = now()
WHERE id = '<manifest-id>' AND status = 'DEAD_LETTER'
  AND last_error_code IN ('PURGE_ACCESS_DENIED', 'PURGE_CONFIGURATION', 'PURGE_ATTEMPTS_EXHAUSTED');
```

Lệnh phải trả `UPDATE 1`. Ghi manifest id, mã lỗi và lý do vào ticket.

## 8. Alert cho purge worker

Ticket #222 thêm alert. Alert đi theo route Telegram hiện có của Alertmanager
(`warning`/`critical` gửi sau `group_wait` 30 giây, nhóm theo `alertname`,
`namespace`, `severity`).

**Alert dựa trên log (Loki ruler):**

- Ruler chạy **bên trong** pod Loki monolithic (`-target=all`), không có workload
  ruler riêng (`ruler.replicas: 0`). Rule nằm trong ConfigMap
  `learning-platform-loki-alert-rules`, mount chỉ đọc tại
  `/etc/loki/rules/fake` (tenant `fake` vì `auth_enabled: false`). Ruler gửi alert
  tới `learning-platform-monitori-alertmanager` trong namespace `observability`.
- `DocumentPurgeDeadLettered` (`warning`): có ít nhất một log
  `document.purge.dead_lettered` từ container `document-purge-worker` trong 10 phút
  gần nhất. Xử lý theo mục 7.
- `DocumentPurgePreflightFailed` (`critical`): có log
  `document.purge.preflight.failed` trong 10 phút gần nhất. Worker không xác nhận
  được versioning của media bucket nên sẽ không Ready; kiểm tra IAM (mục 3) và
  versioning bucket (mục 2).
- Hai alert tự resolve khoảng 10 phút sau log cuối cùng. **Resolve không có nghĩa
  là đã xử lý xong**: manifest vẫn ở `DEAD_LETTER` cho tới khi owner làm theo mục 7.

**Alert pod-health (PrometheusRule `learning-platform.application`):**
`LearningPlatformPodNotReady`, `LearningPlatformContainerCrashLoop` và
`LearningPlatformDeploymentUnavailable` đã bao gồm pod `document-purge-worker-.*`
và deployment `document-purge-worker` (`for: 10m`).

**Kiểm tra chỉ đọc sau khi deploy observability:**

```bash
sudo k3s kubectl get --raw \
  /api/v1/namespaces/observability/services/learning-platform-loki:3100/proxy/prometheus/api/v1/rules
```

Chờ pod Loki Ready thêm khoảng 2 phút rồi mới kiểm tra: ngay sau restart, ruler có
thể chạy trước khi ring sẵn sàng và tạm báo `health: err` (`empty ring`).

Kỳ vọng: nhóm `learning-platform.document-purge` có 2 rule, `health` là `ok`,
`lastError` rỗng.

Ruler còn phải thấy Alertmanager và chưa gửi lỗi. Đọc metric của Loki (chỉ đọc):

```bash
sudo k3s kubectl get --raw \
  /api/v1/namespaces/observability/services/learning-platform-loki:3100/proxy/metrics \
  | grep -E '^loki_prometheus_notifications_(alertmanagers_discovered|errors_total)'
```

Kỳ vọng: `loki_prometheus_notifications_alertmanagers_discovered{user="fake"} 1` và
mọi dòng `loki_prometheus_notifications_errors_total` bằng `0`. Nếu sai, alert purge
sẽ không tới Telegram dù rule vẫn `ok`: dừng việc bật cờ.

**Giới hạn còn lại:** chưa có alert cho manifest `PENDING`/`FAILED` quá 1 giờ.
App chưa phát metric hay log định kỳ về số manifest tồn đọng; cần một thay đổi ở
app (ví dụ log `document.purge.backlog` có `oldestPendingAgeSeconds`) hoặc exporter
SQL rồi mới viết rule. Trước khi có, owner chạy truy vấn:

```sql
SELECT status, count(*), min(next_attempt_at)
FROM course.document_purge_manifests
WHERE status IN ('PENDING', 'FAILED') AND next_attempt_at < now() - interval '1 hour'
GROUP BY status;
```

## 9. Tắt nhanh

- **Khẩn cấp (dừng xóa ngay)**:

  ```bash
  sudo k3s kubectl -n learning-platform-dev scale deployment/document-purge-worker --replicas=0
  ```

  Manifest `PENDING`/`FAILED` giữ nguyên; manifest `RUNNING` hết lease sẽ được
  claim lại khi bật lại. Đây chỉ là biện pháp tạm: lần deploy worker tiếp theo
  khi cờ còn `true` sẽ đưa replica về 1.
- **Tắt có kiểm soát (bền vững)**: PR đổi `document_purge_enabled: false` rồi
  merge. Khi deploy target `worker`, Ansible xóa `deployment/document-purge-worker`
  theo kiểu Foreground (xóa ReplicaSet và pod trước), chờ tới khi không còn pod
  nào có label `app.kubernetes.io/component=document-purge-worker`, rồi mới xóa
  đúng NetworkPolicy `document-purge-worker-egress`, `document-purge-worker-ingress`,
  ServiceAccount `document-purge-worker` và ExternalSecret
  `learning-platform-document-purge-runtime` (ESO tự xóa Secret thuộc sở hữu).
  Thứ tự này cần vì namespace không có default deny: xóa NetworkPolicy trước khi
  pod dừng sẽ để pod giữ credential purge mà không bị giới hạn mạng. Sau khi apply,
  Ansible đọc lại `media-egress-proxy-ingress` và fail nếu còn rule cho purge
  worker.
- **Thu hồi quyền ở S3**: vô hiệu hóa access key của IAM user purge. Làm **sau**
  khi đã scale về 0; nếu worker còn chạy, các manifest đang xử lý sẽ vào
  `DEAD_LETTER` `PURGE_ACCESS_DENIED` và cần đưa lại hàng đợi theo mục 7.
