# Issue #158: Ma trận kiểm chứng media-probe-worker

## Mục đích

Tài liệu này chuyển acceptance criteria của Issue #158 thành các kiểm tra có
thể lặp lại. Đây là tài liệu dự án, không phải danh sách việc cá nhân và không
thay thế code/test hoặc bằng chứng rollout thật.

Ticket #158 chỉ được chuyển `Done` khi các kiểm tra bắt buộc đã có bằng chứng
ở đúng môi trường. CI xanh hoặc readiness `Ready` một mình không chứng minh
được đường đọc object, fencing và hành vi của `ffprobe`.

## Điều kiện chung

- ADR áp dụng: [ADR-0031](../adr/0031-media-probe-and-isolated-worker.md),
  ADR-0023 và các contract ownership/credit hiện hành.
- Local dùng MinIO và PostgreSQL trong Docker Compose; không dùng S3 thật cho
  local test.
- Dev/stg/prod chạy trên VPS; S3 request phải đi qua egress proxy đã cấu hình.
  Không dùng VPC hoặc đường direct S3 làm tiêu chí thay thế.
- Không ghi secret, presigned URL, access key, token, raw AI response hoặc nội
  dung media vào artifact kiểm chứng.

## Ma trận local

| Mã | Kiểm tra | Cách thực hiện | Bằng chứng đạt |
| --- | --- | --- | --- |
| L1 | Readiness binary | Khởi động `media-probe-worker` với image đúng và với `ffprobe` thiếu/sai checksum ở fixture | Image đúng `Ready`; binary thiếu/sai làm readiness fail-closed, không claim job |
| L2 | Tách claim | Đưa đồng thời job `MEDIA_PROBE` và `FULL_PIPELINE` vào PostgreSQL queue; chạy từng worker | Probe chỉ claim `MEDIA_PROBE`; full-pipeline chỉ claim `FULL_PIPELINE`; kiểm tra bằng DB state và log đã redact |
| L3 | First claim locator | Upload một media object vào MinIO versioning enabled; claim lần đầu rồi kiểm row locator | Có `bucket`, `key`, `VersionId` khác rỗng, `ETag`, `ContentLength`, `policyVersion`; không có presigned URL |
| L4 | Đọc đúng version | Tạo version mới cùng key sau first claim; cho retry chạy | Worker vẫn đọc exact `VersionId` đã lưu, không đọc version mới nhất |
| L5 | File hợp lệ | Chạy MP3 hợp lệ và MP4 H.264/AVC + AAC-LC, trong giới hạn duration/size/resolution/fps | Probe thành công; lưu `observedDurationSec`; chuyển đúng bước kế tiếp một lần |
| L6 | Giới hạn media | Dùng fixture duration `0`, quá `7.200s`, MP3 quá `300 MiB`, MP4 quá `500 MiB`, 4K, 60 fps, codec không whitelist, thiếu audio hoặc nhiều track mơ hồ | Mỗi fixture bị từ chối bằng safe failure code; không `PROCESSING`, không `FULL_PIPELINE` |
| L7 | Parser failure | Dùng container malformed, metadata malformed, external protocol reference và stdout probe vượt cap | Probe dừng theo timeout/output cap; cleanup temp; không retry business failure và không enqueue AI |
| L8 | Retry S3 | Làm MinIO trả lỗi network/tạm thời khi đọc exact version | Giữ `PROBING`, backoff/attempt cap đúng policy; lease expiry có thể giao lại; không đọc latest |
| L9 | Fingerprint mismatch | Thay object/version hoặc làm locator không còn khớp trước completion | Completion bị từ chối; không reserve credit, không chuyển `PROCESSING`, không tạo `FULL_PIPELINE` |
| L10 | Completion lặp | Giao cùng delivery nhiều lần, gồm crash trước ACK và sau persist | Chỉ một probe result, một reserve và một `FULL_PIPELINE` outbox; delivery cũ bị fence |
| L11 | Xóa trong lúc probe | Đánh dấu Document `DELETING` sau khi worker claim và trước/sau `ffprobe` | Worker không renew/commit/reserve/enqueue; temp cleanup chạy; purge manifest giữ đủ VersionId |
| L12 | Purge version | Chạy purge lặp với version tồn tại, đã xóa và S3 transient error | Hard-delete đúng version; `NoSuchVersion` là thành công; lỗi quyền vào DLQ/alert, không retry vô hạn |
| L13 | Sandbox process | Kiểm process tree, UID/GID, mount, capabilities, stdin và network namespace trong runtime local | Không shell/child ngoài binary; non-root, rootfs read-only, temp mount bounded, không egress ngoài MinIO network |
| L14 | Resource bound | Render/inspect Compose hoặc manifest local; chạy file lớn trong concurrency cap | CPU/RAM/ephemeral storage/temp size có giới hạn; worker không làm đầy disk dùng chung |

## Ma trận dev VPS

Các kiểm tra dev phải chạy sau khi artifact đã được deploy đúng SHA. Evidence
phải ghi SHA image/checkout, thời điểm kiểm tra và target; không suy ra runtime
từ branch hoặc working tree.

| Mã | Kiểm tra | Cách thực hiện | Bằng chứng đạt |
| --- | --- | --- | --- |
| D1 | Bucket versioning | Dùng read-only capability check `GetBucketVersioning` và `HeadObject` trên media bucket | Trạng thái chính xác `Enabled`; `HeadObject.VersionId` khác rỗng; check fail-closed nếu `Suspended`/null |
| D2 | Image/runtime | Đọc Deployment/Pod đã rollout và kiểm image digest, exact `ffprobe -version`, ServiceAccount và readiness | Probe workload riêng; image không có AI credential/bootstrap hoặc executable full-pipeline không cần thiết |
| D3 | DB role/claim | Kiểm claim operation bằng job type sai và kiểm mutation thiếu lease/fence/expected state | DB/query boundary từ chối job sai và stale mutation; không chỉ dựa vào log ứng dụng |
| D4 | Egress route | Upload media test đã được Owner cho phép; theo dõi request tại egress proxy và firewall/route counter | Probe đọc S3 qua proxy; proxy log không có query string/Authorization; direct S3/Internet/AI route bị chặn thực tế |
| D5 | Proxy fail-closed | Tắt route proxy hoặc cấp route sai trong cửa sổ kiểm thử có kiểm soát | Probe lỗi rõ ràng, không tự fallback direct S3; Document không chuyển `PROCESSING` |
| D6 | Exact version/replay | Tạo version mới cùng key sau first claim; replay delivery cũ | Worker đọc VersionId đã probe; không đọc version mới; duplicate không reserve/generate lần hai |
| D7 | Deletion race/purge | Xóa một Document đang `PROBING` và theo dõi worker + purge | DB commit deletion fence trước; worker cũ không ghi kết quả; purge hard-delete từng version theo manifest |
| D8 | Rendered resource contract | Chạy validator/render test trên manifest triển khai | Concurrency, CPU/RAM, `emptyDir.sizeLimit`, ephemeral-storage, non-root, seccomp, capability drop, read-only rootfs, token mount và proxy route đúng |
| D9 | Crash recovery | Dừng probe Pod giữa claim/probe/completion; đợi lease expiry | Job được giao lại an toàn; không treo `PROBING` vĩnh viễn; không duplicate credit/outbox |
| D10 | Real media path | Dùng MP3/MP4 hợp lệ đã chuẩn bị và theo dõi tới trạng thái user-facing | Probe result và `observedDurationSec` được lưu; full pipeline chỉ bắt đầu sau probe; status/error hiển thị rõ |

## Phân loại bằng chứng

| Loại | Bằng chứng chấp nhận |
| --- | --- |
| Unit/integration | Test output có tên case, kết quả và fixture; PostgreSQL/MinIO thật khi kiểm transaction hoặc object version |
| Runtime local | Container/Pod state, DB state trước/sau, sanitized worker log và kết quả API; không dùng fixture chỉ kiểm readiness |
| Rendered manifest | File render từ source-managed IaC và validator output; không chấp nhận sửa tay trên VPS làm bằng chứng |
| Dev vận hành | SHA đang chạy, trạng thái rollout, capability check S3/proxy, DB state, object VersionId và kết quả media thật |
| Security negative | Kết quả chứng minh đường bị chặn thực tế hoặc mutation bị từ chối; chỉ có error code không đủ cho network bypass |

## Retest local 2026-10-09

- Bằng chứng đầu ra đã lọc, lưu ngoài Git tại
  `/tmp/learningplatform-158-evidence-20261009/sanitized-tool-output.md`;
  SHA-256: `ccda9be35209668836cab9a2af075c15338f647ca44c688ec8f8f7029f2a2836`.
  Đây là các dòng kết quả an toàn trích từ tool output, không phải raw log.
- Hai lượt harness E2E fake-provider đạt `PROCESSING`: probe `COMPLETED`,
  `source_version_id` trùng `result.version_id` và chỉ có một job
  `FULL_PIPELINE` ở `PENDING`. Ba lượt khác lỗi `EPIPE` tại presigned POST
  sau khi API trả `201`; cả năm lượt dùng PostgreSQL/MinIO và volume riêng
  theo `local-document-e2e-<pid>`, được harness dọn sau mỗi lượt. Lệnh gốc:
  `LOCAL_DOCUMENT_E2E_PROVIDER_MODE=fake bash worker/scripts/local-document-e2e.sh`;
  ba lượt chẩn đoán dùng bản sao tạm của cùng script, tự xóa sau khi chạy.
  Chế độ fake chỉ thay provider của AI worker; media-probe Go worker vẫn chạy
  `ffprobe` thật. Cổng kiểm chứng dừng ở `PROCESSING`, không bao gồm extraction.
- Một lượt chẩn đoán cũ thấy health endpoint qua Node không kết nối được
  (`unreachable`), trong khi `curl` tới cùng host-published port trả `200`;
  health loopback `127.0.0.1:9000` trong MinIO container cũng trả `200` và
  container vẫn `running`. Các health probe này bất đồng theo client nên
  không cô lập được Docker forwarding hay chứng minh POST thất bại đã tới
  MinIO. Không có bằng chứng MinIO restart/OOM.
- Trace Undici mới của luồng gốc ghi `upload-url` trả `201`, sau đó POST tới
  origin MinIO được kết nối (`localPort` và `remotePort` được ghi trong artifact)
  rồi lỗi `EPIPE` sau `3 ms`. Không có event `request:bodySent` hoặc response
  headers; thời gian lỗi ngắn hơn nhiều so với `AbortSignal.timeout(10_000)`.
  Artifact JSON đã lọc nằm ngoài Git tại
  `/var/folders/8t/6jkgfvhd2szdqn1813hypj6m0000gn/T/learningplatform-158-undici-final-khy6msyx/original-process.json`;
  SHA-256 `4770bd6e3847437ed4d7ebb062138aff856b4d68198972c1fd4e59d8f4bb44d9`.
  Kết quả này cho thấy lỗi ghi request phía client sau khi socket kết nối,
  nhưng chưa xác định peer nào đóng socket và chưa phải bằng chứng server-side.
- Cùng lượt trace ghi fixture là `4.909` bytes, điều kiện policy min/max đều
  `4.909` bytes và `Content-Length` multipart là `6.553` bytes. Đây là kích
  thước file so với kích thước envelope multipart; đối chiếu tài liệu S3 xác
  nhận `content-length-range` áp dụng kích thước nội dung file. Không kết luận
  đây là lỗi policy.
- So sánh đã ghi trước đó trên đúng signed form cho thấy `HeadObject` trước
  replay là missing; fresh Node process trả `204` sau `119 ms`, còn `curl` trả
  `204` sau `8 ms`. Mã `postForm()` dùng Node global `fetch` cùng `FormData`, rồi
  đọc `response.arrayBuffer()`; nhãn `node-fetch` trong output cũ chỉ là nhãn
  kiểm thử, không chứng minh đã dùng package `node-fetch`. Bằng chứng đã lọc
  nằm tại `/tmp/learningplatform-158-evidence-20261009/exact-form-replay-sanitized.txt`;
  SHA-256 `73b615d622be3cfe0a2f4df962e420fafa5f68cd803679a3528a344814c8fa39`.
  Đây là replay ở process mới, chưa phải phép so sánh timeout/no-timeout trong
  cùng process.
- Bài POST tối giản dùng MinIO disposable cùng image digest
  `sha256:8343eea75f4f7ef6394e3e1f1a5447706bac719bf8b0731cbbf4c473f3050712`:
  mã nguồn client dùng global `fetch` và trả `204` ở 5/5 lượt trên Node
  `v25.9.0`/Undici `7.24.4`; curl trả `204` ở 5/5 lượt. Output cũ gọi client
  bằng nhãn `node-fetch`, nhưng nhãn đó không xác nhận tên package. Health trả
  `200` trước và sau, container không restart hoặc OOM. Bài thử này không tái
  hiện lỗi chập chờn.
- Năm lượt E2E lịch sử ở artifact đầu tiên vẫn được giữ thành một cohort riêng:
  `2 PASS / 3 EPIPE`. Một lượt chẩn đoán Undici bổ sung cũng tái hiện `EPIPE`
  một lần như mô tả ở trên. Các lượt thành công mới bên dưới không giải thích
  các lần thất bại lịch sử.
- Sau các lần tải `mc` trước đó thất bại (`image` pin bị registry từ chối,
  một URL binary trả `410`, Quay trả `401`), trace đã chạy thành công qua
  sanitizer allowlist. Một lượt baseline và hai lượt follow-up hoàn tất E2E
  thành công khi trace sống cả trước và sau document flow. Baseline ghi
  `PostPolicyBucket 204`, hai `HeadObject 200` và `GetObject 200` trong cửa sổ
  UTC 2 giây; harness trả `PASS`. Trong hai follow-up, client POST trả `204`
  lần lượt sau `24.993 ms` và `27.686 ms`; mỗi lượt tiếp tục qua
  `PROCESSING`/`PASS`, với trace `HeadObject 200` hai lần và `GetObject 200`.
  Cùng-process replay hook chỉ chạy khi POST thất bại nên không kích hoạt ở
  các lượt thành công. Một lượt untraced kế tiếp cũng trả `POST 204` sau
  `52.791 ms` và `PASS`; replay hook không kích hoạt. Đây là bốn kết quả pass
  bổ sung thuộc lượt chẩn đoán mới, không thay thế cohort lịch sử `2/5`.
- Trace baseline gắn POST và kiểm tra object bằng cửa sổ document flow hẹp,
  không bằng path hash: hash POST khác hash của `HeadObject`/`GetObject` vì
  key nằm trong form POST. Do đó đây là tương quan theo thời gian trong harness
  cô lập, không phải phép join request trực tiếp. Các trace này chứng minh
  server xử lý POST thành công ở các lượt pass; chúng không cho biết MinIO đã
  nhận hay phản hồi thế nào trong lượt `EPIPE`.
- Artifact ngoài Git, quyền thư mục/file `0700`/`0600`: baseline summary
  `/tmp/lp158-baseline-20261009/trace-window-summary.txt` SHA-256
  `d75b820a8ebd7cf174587b0da7bfb3dedbfe11d05777ad1eb8eb9897b6a65c67`, trace
  `/tmp/lp158-baseline-20261009/minio-trace.jsonl` SHA-256
  `8e0bae0e2dbbd7ec666b98ada378485a1f039e51975b330edb7a09d2c4653469`, script
  `/tmp/lp158-baseline-20261009/local-document-e2e-trace.sh` SHA-256
  `ecfa9dd82a61e5e53d2965a7350df563c52814d985ef18aba8569616c7f5ca30`;
  follow-up 01 summary `/tmp/lp158-followup-20261009/attempt-01/trace-window-summary.txt`
  SHA-256 `f1d5a886988af0bc5199ed323dc13b996e70fe7b660d419f544661d085d8cda9`,
  trace `/tmp/lp158-followup-20261009/attempt-01/minio-trace.jsonl` SHA-256
  `66c72b9ccb8ce1ad5801978a594677009455ea50de615ff26c7d5284027c90a3`, script
  `/tmp/lp158-followup-20261009/attempt-01/local-document-e2e-trace.sh` SHA-256
  `d6fc21862a3306620b74f1e9adc61a8747bcd4a95f95dff1dabe61912d68a2fd`;
  follow-up 02 summary `/tmp/lp158-followup-20261009/attempt-02/trace-window-summary.txt`
  SHA-256 `82f2829acfb17ed2520ea3b1b7e95ea6c658c1aa1901522520d163c616fe929a`,
  trace `/tmp/lp158-followup-20261009/attempt-02/minio-trace.jsonl` SHA-256
  `78bcafe20788e28764731469ee9cb937854b64be6c1d791ed5583cccba7f3cca`, script
  `/tmp/lp158-followup-20261009/attempt-02/local-document-e2e-trace.sh` SHA-256
  `6d3520f59be53ca9453e6c01f6c2e1ce6f8d19f0cf78f41b05ab6f07b4efd51e`;
  untraced client marker `/tmp/lp158-untraced-20261009/run-01/client-post-markers.txt`
  SHA-256 `092b41d2bdb391c56a37281d4e9f1b88576e964e9b0e1d5ad16497ec1b1914ab`,
  script `/tmp/lp158-untraced-20261009/run-01/local-document-e2e-notrace.sh`
  SHA-256 `60420efe1c356418b54f2f1394e4bce121c3d8242c257bba2da8798c32030fb7`.
  Một lần trace producer lỗi trong setup trước `document-flow` không phải bằng
  chứng cho POST và không được tính vào các lượt trên. Raw trace stream không
  được lưu; các JSONL là kết quả đã qua sanitizer.
- Kiểm tra mới chạy: `go test ./...`, `go test -race
  ./internal/mediaprobe ./internal/processing`, sáu Jest suite AI ingestion,
  content confirm/delete/retry, forward relay và return relay (89 tests), năm
  app build trong harness, và hai E2E thành công tại thời điểm artifact đầu.
  Các kiểm tra này pass; ba E2E khác trong cohort lịch sử vẫn lỗi upload như
  mô tả trên. Các lần E2E bổ sung nêu riêng ở trên. Jest chạy bằng
  `npm test -- --runInBand src/modules/ai/ai-ingestion.spec.ts src/modules/content/content.confirm.spec.ts src/modules/content/content.delete.spec.ts src/modules/content/content.retry.spec.ts src/modules/content/forward-relay.spec.ts src/worker/return-relay.spec.ts`;
  IaC chạy bằng `bash infra/scripts/validate.sh` và pass (có warning thiếu
  document-start trong fixture YAML, không có task thất bại).
- Kết luận local: `PARTIAL`; luồng API → MinIO → media-probe → `PROCESSING`
  đã chạy được trong nhiều lượt, gồm ba E2E có MinIO trace và một lượt
  untraced. Tuy nhiên các lượt mới không tái hiện `EPIPE`; một trace riêng của
  lỗi cho thấy Node nhận `EPIPE` sau khi socket kết nối nhưng trước
  `bodySent`/response headers. Chưa xác định peer đóng socket hoặc nguyên nhân
  gốc, chưa có server-side trace của chính request thất bại và chưa có cơ sở
  sửa code. Không tuyên bố ổn định hoặc đóng ticket từ các lượt pass này.

## Cổng hoàn thành ticket

- [ ] L1-L14 đã pass ở local hoặc có blocker cụ thể được ghi rõ.
- [ ] D1-D10 đã pass trên dev VPS sau rollout; các mục chưa có môi trường phù
  hợp phải ghi `N/A` kèm lý do, không đánh dấu pass giả.
- [ ] Có bằng chứng completion transaction không tạo duplicate credit/outbox.
- [ ] Có bằng chứng deletion fence thắng worker cũ và purge manifest không mất
  VersionId.
- [ ] Có bằng chứng direct S3/Internet/AI bypass bị chặn qua topology VPS.
- [ ] Ticket comment chốt nêu chính xác ticket #158, SHA, lệnh/kiểm tra đã
  chạy, kết quả, bằng chứng runtime và Next step. Chỉ chuyển Project sang
  `Done` sau khi tất cả hoạt động liên quan đã có kết luận.

## Directed diagnosis - 2026-10-10

- Năm cohort chẩn đoán có kiểm soát đều đạt 20/20 upload `204` (100 lượt POST
  thành công tổng cộng). Đây là thử nghiệm chẩn đoán, không phải 100 lượt E2E
  nghiệp vụ.

  | Cohort | Runtime / trình tự | Kết quả | Artifact |
  | --- | --- | --- | --- |
  | Warm lifecycle | Node `v25.9.0`, Undici `7.24.4`; cùng process, tái sử dụng kết nối | 20/20 body gửi, response `204`, 0 lỗi; 2 connections | `/tmp/lp158-lifecycle-20261009T165353Z-86902/lifecycle-metrics.json` |
  | Fresh lifecycle | Node `v25.9.0`, Undici `7.24.4`; process/kết nối mới mỗi lượt | 20/20 body gửi, response `204`, 0 lỗi; 20 connections | `/tmp/lp158-lifecycle-20261009T165353Z-86902/lifecycle-metrics.json` |
  | API trước lịch sử S3 | Node `v25.9.0`, Undici `7.24.4`; API tối giản | 20/20 API `201`, upload `204`, 0 lỗi | `/tmp/lp158-minimal-api-20261009T170327Z-2881/revision-03/cohort-A20.jsonl` |
  | API sau lịch sử S3 | Node `v25.9.0`, Undici `7.24.4`; sau round-trip storage theo source | 20/20 API `201`, upload `204`, 0 lỗi | `/tmp/lp158-minimal-api-20261009T170327Z-2881/revision-05/cohort-B20.jsonl` |
  | Node 22, cùng lịch sử S3 | Node `v22.22.2`, Undici `6.24.1`; cùng trình tự với cohort trước | 20/20 API `201`, upload `204`, 0 lỗi | `/tmp/lp158-minimal-api-20261009T170327Z-2881/revision-06/cohort-C20.jsonl` |
- Các kiểm soát storage trả kết quả đúng: POST hợp lệ `204`, sai key/MIME `403`,
  sai kích thước `400`; object bị từ chối không tồn tại theo lịch sử
  `HeadObject` tương ứng.
- Lượt chạy thực tế mới dùng artifact
  `/tmp/lp158-followup-20261010/attempt-01/local-document-e2e-trace.sh`, SHA-256
  `ddb9a0d56705756da85d1d058c70651a8e94b5600365dac4ab91c46c4b6d895c`.
  Upload POST trả `204` sau `26.756 ms`, API create `201`, confirm `202`;
  `DOCUMENT_STATUS PROCESSING`, `MEDIA_PROBE_STATUS COMPLETED`, version IDs
  khớp và khác null, `FULL_PIPELINE_JOB_COUNT 1`, trạng thái `PENDING`,
  `RESULT PASS`. Trace MinIO ghi policy POST `204`, bucket location `200`, hai
  `HeadObject 200` và `GetObject 200`.
- Kết quả xác nhận lượt này đi qua media-probe; `PENDING` thuộc bước trích xuất
  phía sau của issue #160. Các dữ kiện không giải thích lỗi `EPIPE` trước đó
  và không phải nguyên nhân gốc đã được tìm ra: lỗi ấy từng xuất hiện khoảng
  `3 ms` và hiện chưa được tái hiện. Không có sửa đổi mã ứng dụng.
- Kết luận tại thời điểm ghi nhận phần này là `PARTIAL`: cohort khi đó không tái
  hiện lỗi và không xác định Node 25 là thủ phạm. Các lượt có capture mới hơn ở
  phần bổ sung cuối tài liệu thay thế nhận định về tình trạng tái hiện `EPIPE`;
  chúng vẫn chưa xác định peer đóng kết nối. Chưa có deploy.

## Follow-up relay và giới hạn credit - 2026-10-10

- Một lượt E2E cô lập gồm sáu flow dừng ở flow 6 sau khi năm flow trước đã
  chuyển sang `PROCESSING`. Mỗi flow giữ lại 1.740 credit trong lúc job
  `FULL_PIPELINE` còn `PENDING`; ví chỉ còn 1.300 credit sau flow 5. Completion
  của flow 6 cần 1.740 credit nên `completeProbe` ném `BudgetExhaustedError`
  trong transaction. Vì transaction rollback, probe vẫn `COMPLETED` với result
  và version khớp, Document vẫn `PROBING`, không có full-pipeline job, và hàng
  `DocumentProbeCompleted` còn unpublished. Snapshot ghi tuổi outbox 120 giây.
- Log đã lọc chỉ giữ số lượng event/stage: năm lần `probe_projected`, 22 lần
  `ai.job.return.failed` tại `probe-project`, và 22 lần worker cycle failed/backoff
  trong cửa sổ polling. Điều này xác nhận relay đã chạy nhưng completion không
  thể reserve credit; không phải worker lifecycle stall hoặc upload `EPIPE`.
- Một lần đối chứng cô lập chỉ tăng `AI_FREE_CREDITS` từ 10.000 lên 20.000.
  Cả sáu flow pass; flow 6 đạt `PROCESSING`, probe `COMPLETED`, một pipeline job
  `PENDING`, outbox completion đã publish, ví còn 9.560 và giữ 10.440 credit.
  Kết quả phân biệt giới hạn ví của fixture với lỗi transport ban đầu; không xác
  nhận hoặc loại trừ nguyên nhân của `EPIPE`.
- ADR-0031 yêu cầu reserve credit và tạo pipeline request nguyên tử. Test
  `return-relay.spec.ts` hiện có cũng yêu cầu rollback và giữ completion event
  pending khi reserve thất bại; contract phục hồi Document khi hết credit chưa
  được chốt tại thời điểm ghi nhận. Quyết định sau đó là giữ receipt/locator,
  project `FAILED/BUDGET_EXHAUSTED/EXHAUSTED`, acknowledge completion mà không
  reserve/tạo pipeline, rồi cho Owner retry generation mới trên đúng VersionId
  sau khi nạp credit. Lỗi database, authorization và stale fence vẫn fail-closed.
- Artifact chẩn đoán đã sanitize: `/var/folders/8t/6jkgfvhd2szdqn1813hypj6m0000gn/T/lp158-probe-state-20261010-gf1rcyzv/probe-snapshot-attempt-6.txt`,
  `/tmp/lp158-probe-rerun-20261010/run.out` và
  `/tmp/lp158-probe-rerun-20261010/funded-run.out`. Harness đã dọn container,
  volume, network và process do lượt chạy tạo.
- Kiểm tra lần này: `npm test -- --runInBand src/worker/return-relay.spec.ts
  src/modules/content/content.confirm.spec.ts` pass, 2 suites/40 tests;
  `go test -race ./internal/mediaprobe` pass. Không sửa mã ứng dụng.
- Kết luận issue #158 vẫn là `PARTIAL`: EPIPE chưa tái hiện và peer đóng socket
  vẫn chưa rõ. **Next step:** lấy trace phía nhận trong đúng cửa sổ request lỗi
  EPIPE; theo dõi contract thiếu credit bằng quyết định/ticket riêng.

## Receiver-side transport capture - 2026-10-10

- Preflight cô lập dùng HTTP server Alpine riêng trên cổng `9000` và tcpdump
  sidecar có `NET_RAW` trong cùng network namespace. Request HTTP trả `200`;
  bộ lọc metadata đọc được TCP flags và loại các dòng khác. Các SYN/RST trước
  HTTP `200` là lần thử khi server fixture chưa sẵn sàng, không phải dữ liệu
  của issue #158. Artifact đã sanitize nằm tại
  `/tmp/lp158-receiver-capture-20261010/run-03/`.
- Lượt thử trước `run-04` nhận MinIO `PostPolicyBucket 204` nhưng dừng ngay sau
  upload vì diagnostic helper tạm đọc biến thời gian ngoài phạm vi. Lượt đó
  không được tính là E2E hoàn chỉnh. Helper tạm đã được sửa và kiểm tra bằng
  request mock trả `204`; JSON chẩn đoán chỉ giữ fingerprint, thời điểm, thời
  lượng, kích thước và sự kiện socket, không giữ URL ký hoặc form.
- Một E2E hoàn chỉnh tại
  `/tmp/lp158-receiver-capture-20261010/run-05/` pass: client gửi đủ body,
  nhận header `204` sau `17.514 ms`; Node `v25.9.0`, Undici `7.24.4`, request
  fingerprint `1792d195bbae4fd9b2f4f98055c1e8c1b24e4bf4ea7ce2db38b9e3f313ca0dd3`.
  MinIO trace ghi đúng một `PostPolicyBucket 204` lúc
  `2026-10-09T19:11:54.959Z`. Receiver capture đã báo listening trước lượt chạy
  và ghi 20 dòng TCP metadata, không có RST. Một SYN tới receiver lúc
  `19:11:54.957989Z`, cùng cửa sổ thời gian với POST.
- Tuple phía client là `127.0.0.1:63346 -> 127.0.0.1:63314`; tuple phía
  receiver là `172.19.0.1:64240 -> 172.19.0.3:9000`. Host port forwarding làm
  tuple khác nhau và chưa có ánh xạ chứng minh hai tuple thuộc cùng socket;
  đối chiếu hiện chỉ dựa trên thời gian và operation MinIO. Kết quả E2E là
  Document `PROCESSING`, probe `COMPLETED`, version khớp, một job
  `FULL_PIPELINE` `PENDING`, completion outbox đã publish.
- Lượt này không tái hiện `EPIPE` và không xác định peer đóng socket trong lần
  lỗi lịch sử. Issue #158 vẫn `PARTIAL`; không có sửa đổi mã ứng dụng, deploy
  hoặc publish. Harness tái sử dụng nằm ở
  `/tmp/lp158-receiver-capture-20261010/local-document-e2e-probe-state.sh`;
  mỗi lần tạo thư mục artifact riêng với quyền `0700` và từ chối trùng thư mục.
  **Next step:** bật capture trước lượt tái hiện có mục tiêu tiếp theo; nếu
  `EPIPE` xuất hiện, giữ artifact của lượt đó và đối chiếu thời gian cùng TCP
  flags với client/MinIO trace. Không chạy thêm cohort rộng và không suy ra lỗi
  đã được khắc phục từ lượt pass này.

## Regression implementation - 2026-10-10

- `deleteOwnedDocument` lấy advisory lock chung với enqueue và lần ghi VersionId
  đầu tiên trước khi chụp locator. Transaction khóa các `ai.media_probe_jobs`
  của đúng Document/Owner, union các locator hợp lệ với Document/preflight và
  `course.document_probe_receipts`, sau đó hủy job trong cùng transaction.
  Worker Go dùng cùng lock và kiểm lại owner, document, generation, policy, fence,
  lease và `RUNNING` trước khi persist.
- Test PostgreSQL `content.delete.spec.ts` khóa worker advisory lock, khởi chạy
  deletion và quan sát deletion đang chờ trong `pg_locks`; worker ghi version
  first-claim rồi commit. Purge manifest giữ cả version first-claim và version
  upload hiện tại, job kết thúc `CANCELLED`.
- Test PostgreSQL `content.confirm.spec.ts` xác nhận ví thiếu credit vẫn lưu
  receipt/VersionId và không tạo pipeline request; sau top-up retry tạo generation
  mới trên cùng VersionId, completion lặp chỉ reserve một lần.
- Lệnh đã chạy: `npm test -- --runInBand src/modules/content/content.delete.spec.ts`
  pass, 14 tests; `npm test -- --runInBand src/modules/content/content.delete.spec.ts
  src/modules/content/content.confirm.spec.ts` pass, 30 tests; suite này gọi
  `TestPersistLocatorWaitsForDeletionFence` trong Go trên cùng PostgreSQL fixture,
  xác nhận method thật chờ shared advisory lock và trả `ErrJobFenceLost` sau khi
  deletion hủy job. `go test ./internal/mediaprobe` pass; `npm run build` pass,
  gồm Nest build và xác minh đủ 68 migration assets trong `dist`.
- Hai lượt chạy mới sau thay đổi bằng
  `LOCAL_DOCUMENT_E2E_PROVIDER_MODE=fake bash worker/scripts/local-document-e2e.sh`
  đều dừng trước confirm/probe ở presigned PUT: lần đầu `UND_ERR_SOCKET`, lần
  hai `EPIPE`, destination là host port MinIO đang chạy. Cả hai harness tự dọn
  fixture riêng và không tạo data ngoài các container/volume của lượt chạy.
- Một lượt có receiver-side capture sau đó pass bằng
  `/tmp/lp158-receiver-capture-20261010/local-document-e2e-probe-state.sh`.
  Artifact sanitize nằm tại
  `/tmp/lp158-receiver-capture-20261010/local-document-e2e-56508/`: client ghi
  `POST` bodySent rồi `204` trong `20.041 ms`; MinIO trace ghi `PostPolicyBucket
  204` lúc `02:45:21.116Z`, tiếp theo `HeadObject 200` và `GetObject 200`.
  Probe `COMPLETED`, VersionId khớp, Document `PROCESSING`, một pipeline job
  `PENDING`, completion outbox đã publish; worker health và readiness đều `200`.
  Capture ghi SYN/FIN, không RST. NAT khiến tuple client `127.0.0.1` khác tuple
  receiver `172.19.0.x`, nên tương quan chỉ dựa trên timestamp. Script trỏ worker
  tới host-published MinIO port; lượt pass này không chứng minh internal-only
  Docker network path. Lượt pass cũng không xác định nguyên nhân hai lỗi trước
  và không chứng minh `EPIPE` đã được sửa.
- Các kiểm tra trên là local Testcontainers/unit evidence. Chưa deploy và chưa
  xác nhận runtime VPS; lỗi `EPIPE` đã tái hiện trong hai lượt local mới nhưng
  peer đóng socket chưa rõ. **Next step:** giữ issue #158 mở cho đến khi có trace
  phía nhận trong đúng cửa sổ lỗi, đồng thời hoàn tất proxy/network và rendered
  deployment contract theo các mục chưa đánh dấu. Không deploy nhánh review này.

## Bổ sung kiểm chứng nhánh review - 2026-10-10

- Harness tracked hỗ trợ `LOCAL_DOCUMENT_E2E_MEDIA_PROBE_IMAGE` để chạy chính
  image Linux của media-probe trên mạng fixture riêng; API vẫn gửi presigned
  multipart POST tới MinIO như trước. Kiểm tra này dùng Node `v22.22.2` native
  Darwin arm64, chế độ provider fake cho AI worker, và image
  `learningplatform-media-probe:issue-158-current` có image ID
  `sha256:eebab8babbec037cf128c78ff8ba640cc2deacad23b14a06d7d64b42e66f8113`.
  Image báo ffprobe `8.1.3-16-ge0a878dd70-20261009`; health và readiness đều pass.
- Lượt chạy có receiver capture kết thúc `PASS`: Document `PROCESSING`, probe
  `COMPLETED`, VersionId lưu trong probe khớp VersionId receipt, một job
  `FULL_PIPELINE` ở `PENDING`. MinIO trace đã sanitize ghi policy POST `204`,
  `HeadObject 200` và `GetObject 200`. Artifact:
  `/tmp/lp158-node22-receiver.GluGCp/harness-output-pass.txt` SHA-256
  `99a5b6d9f1c88536dc963d8cd1f524ad043137a2063f5d9d29b4d8fd43e82022`;
  `/tmp/lp158-node22-receiver.GluGCp/minio-trace.jsonl` SHA-256
  `23d59a3b1fe7125265b141ce042be849ac90bb451d0651755d02f97d3d30e9bb`.
  Receiver capture control sẵn sàng; TCP flags JSONL rỗng nên không chứng minh
  FIN/RST hay peer đóng socket.
- Một lượt Node `v22.22.2` khác với cùng image mode dừng tại presigned upload:
  client trả marker đã sanitize `TypeError`, `code=EPIPE`,
  `causeCode=UNKNOWN`; artifact
  `/tmp/lp158-media-probe-image-e2e-node22-20261010.txt` SHA-256
  `c378e10e0cd94fea8b0112305a6455787c1bcd5b615b139719603f2db9be7104`.
  Như vậy local upload `EPIPE` vẫn tái hiện không ổn định; lượt pass chứng minh
  đường nghiệp vụ hoạt động trong một lần, không xác định nguyên nhân và không
  chứng minh lỗi đã được sửa.
- Mã triển khai tại SHA `ea53c93872362ce104a98e9280ccfe64788b6643` pass kiểm tra;
  các lệnh này đã chạy lại sau commit tài liệu `7881750395869210b9b042dd7a569714618aa7fc`
  khi mã không đổi. Chín
  Jest suite mục tiêu pass với 126 test; `npm run build` pass và xác minh 68
  migration assets; `go test ./...`, `go test -race ./internal/mediaprobe`,
  kiểm tra workflow/classifier, application media contract và
  `bash infra/scripts/validate.sh` đều pass. Log Nest:
  `/tmp/lp158-final-nest-tests-20261010.log` SHA-256
  `2f4b365a8d1faae530fef7631243febc0c0dff9a31e146caad27da9ac548461d`;
  build `/tmp/lp158-final-app-build-20261010.log` SHA-256
  `b20a52407781b2fe1dd987b09ab48edb973a0a89bf1f7733a07333cbba31cbfd`;
  Go `/tmp/lp158-final-go-tests-20261010.log` SHA-256
  `490148c7d0f64ded30f46a144b5fedc149289a5dde9ebcbfe91ccfeb1e12eca4`;
  race `/tmp/lp158-final-go-race-20261010.log` SHA-256
  `c5a9d2e4a52fcb45f3ea64a86f80969830da7fef62586ee98cf1e41ab2255a8c`;
  workflow/classifier/application-media checks
  `/tmp/lp158-final-workflow-tests-20261010.log` SHA-256
  `27727f96dd194f733ac45d83fd78c976be4931af854f783a5d5e63d98513a0fd`;
  log hạ tầng đầy đủ:
  `/tmp/lp158-integration-infra-validation-20261010.log` SHA-256
  `cf8500958e197db83bdcbbb6e36c1bcb0d566db2a0e47b7b35ad4c5ff276f908`.
- Issue #158 vẫn `PARTIAL`: bằng chứng runtime chỉ local với provider fake và
  image probe đã pin; chưa deploy hoặc kiểm chứng trên VPS, chưa hoàn tất các
  cổng D1-D10. **Next step:** review PR và tiếp tục giữ ticket mở; nguyên nhân
  gốc của `EPIPE` và bằng chứng topology VPS còn thiếu.
