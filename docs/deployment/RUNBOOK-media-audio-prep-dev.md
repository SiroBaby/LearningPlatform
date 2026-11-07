# RUNBOOK chuẩn bị audio cho media (STT) trên dev K3s (#160 PR4)

Tài liệu này dành cho owner trước và sau khi bật `media_probe_audio_prep_enabled`.
Mặc định cờ là `false`: không có gì thay đổi cho tới khi owner làm các bước dưới.

## 1. Tính năng này làm gì

- **Dùng để làm gì**: sau khi `ffprobe` đạt, `media-probe-worker` dùng `ffmpeg`
  (cùng artifact BtbN đã pin cho `ffprobe`) để giải mã audio, đo thời lượng thật,
  hạ xuống mono 16 kHz MP3 32 kbps và cắt thành chunk. Chunk được tải lên
  `derived-audio/` trong media bucket để bước STT sau này (PR5) đọc đúng `VersionId`.
- **Cách chạy**:
  1. Đo thời lượng giải mã (decode vào stdout, đếm byte, không ghi đĩa). Lệch
     metadata quá `max(5 giây, 2%)` là `MEDIA_DURATION_MISMATCH`; dài hơn 7200
     giây là `MEDIA_DURATION_EXCEEDED`; cả hai không retry.
  2. Chia chunk theo `PlanAudioChunks`: thân 600 giây, overlap (vùng chồng lấn) 5
     giây mỗi phía. Mỗi chunk khoảng 2,4 MB, nhỏ hơn nhiều giới hạn STT 25 MiB nên
     giữ nguyên các số của ADR-0032; trần cứng 25 MiB vẫn được kiểm bằng `-fs`.
  3. Với từng chunk: ffmpeg cắt, kiểm fence, `PutObject`, rồi ghi hàng vào
     `ai.media_audio_chunks` (kèm `VersionId`, `ETag`, `sha256`, mốc thời gian) trong
     một transaction có advisory lock và `lockActiveJob`.
  4. `Complete` chỉ chạy khi đủ số chunk đã ghi, và lưu `decoded_duration_ms` vào
     `ai.media_probe_results` (và `decodedDurationMs`, `audioChunkCount` vào outbox
     `DocumentProbeCompleted`) để Node tính credit theo thời lượng giải mã.
- **Key**: `derived-audio/<ownerId>/<documentId>/<probeGeneration>/<index>.mp3`.
  Cùng probe generation luôn trỏ cùng key; retry và reclaim dùng lại chunk đã ghi
  thay vì tải lên lần nữa.
- **Cờ**: `media_probe_audio_prep_enabled` trong `infra/ansible/vars/dev.yml`
  (mặc định `false`) render thành `MEDIA_PROBE_AUDIO_PREP_ENABLED`. Khi `false`,
  worker chạy đúng như trước (chỉ `ffprobe`) và `decoded_duration_ms` là `NULL`.
- **Thay đổi tài nguyên**: `emptyDir` `media-probe-temp` và `ephemeral-storage`
  tăng từ 550Mi lên 600Mi (nguồn tối đa 500 MiB + một chunk tối đa 25 MiB; ffmpeg
  không ghi file nào khác). CPU/memory giữ nguyên (`-threads 1`). Image tăng thêm
  khoảng 173 MB vì có thêm binary `ffmpeg` tĩnh.

Nguồn: `worker/internal/mediaprobe/audio_prep.go`, `ffmpeg.go`,
`postgres_audio.go`, `app/src/database/migrations/1787803980000_add_media_audio_chunks.up.sql`,
`infra/k8s/apps.yaml.j2`, ADR-0032 D3/D4/D9/D10.

## 2. Owner cấp IAM (qua AWS Console, repo không đụng AWS)

Tên bucket thật lấy từ SSM `/learning-platform/dev/object-storage-media-bucket`
(placeholder `<MEDIA_BUCKET>`).

### 2.1. Identity media-probe: chỉ thêm `PutObject` theo prefix

Thêm statement sau vào policy của IAM user media-probe (giữ nguyên quyền đọc
hiện có, không thêm Delete):

```json
{
  "Sid": "ProbeWriteDerivedAudio",
  "Effect": "Allow",
  "Action": ["s3:PutObject"],
  "Resource": "arn:aws:s3:::<MEDIA_BUCKET>/derived-audio/*"
}
```

Worker không cần `s3:PutObjectVersion`, `s3:ListBucket` hay `s3:DeleteObject*`.

### 2.2. Identity purge: mở rộng `DeleteObjectVersion` sang prefix mới

Statement `PurgeMediaVersions` trong `RUNBOOK-document-purge-dev.md` mục 3 hiện chỉ
cho `media/*`. Purge manifest giờ có cả locator `derived-audio/`, nên nếu không
mở rộng, các locator này vào `DEAD_LETTER` `ACCESS_DENIED`. Đổi `Resource` thành:

```json
"Resource": [
  "arn:aws:s3:::<MEDIA_BUCKET>/media/*",
  "arn:aws:s3:::<MEDIA_BUCKET>/derived-audio/*"
]
```

### 2.3. Identity full-pipeline (cho PR5, chưa cần ở PR này)

`s3:GetObject` và `s3:GetObjectVersion` trên `arn:aws:s3:::<MEDIA_BUCKET>/derived-audio/*`.

## 3. Owner tạo lifecycle rule (tự hết hạn) cho prefix

Đây là lớp bảo hiểm cho object mồ côi (xem mục 6), không thay purge manifest.
Rule hết hạn cả phiên bản hiện tại lẫn noncurrent (phiên bản cũ) sau khoảng 2 ngày:

```json
{
  "Rules": [
    {
      "ID": "expire-derived-audio",
      "Status": "Enabled",
      "Filter": {"Prefix": "derived-audio/"},
      "Expiration": {"Days": 2},
      "NoncurrentVersionExpiration": {"NoncurrentDays": 1},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}
    }
  ]
}
```

Lưu ý: bucket bật versioning nên `Expiration` chỉ thêm delete marker ở ngày 2; phiên
bản đó thành noncurrent và bị xóa thật sau `NoncurrentDays` (tối thiểu 1 ngày),
tức tổng khoảng 3 ngày. Gộp rule này vào cấu hình lifecycle hiện có của bucket
(API `put-bucket-lifecycle-configuration` ghi đè toàn bộ), không tạo một cấu hình
thay thế làm mất rule khác. Không đặt rule nào cho `media/`.

## 4. Điều kiện trước khi bật cờ

1. Migration `1787803980000_add_media_audio_chunks` đã chạy trên database dev
   (cùng lần deploy backend; migration chỉ thêm bảng và một cột nullable).
2. Image `media-probe-worker` mới (có `ffmpeg`) đã chạy ổn với cờ `false`.
3. IAM mục 2.1 và 2.2, lifecycle mục 3 đã tạo.
4. **Negative check** (owner chạy local, key giả): với credential media-probe,
   `put-object` vào `derived-audio/negative-check/x.mp3` phải thành công, còn
   `put-object` vào `media/negative-check/x.mp3` và `delete-object` phải
   `AccessDenied`. Xóa object kiểm tra bằng credential có quyền hợp lệ.
5. Đo ffmpeg trên dev với một file 2 giờ (giới hạn lớn nhất): thời gian giải mã
   + cắt phải nhỏ hơn `AI_WORKER_JOB_TIMEOUT_MS` (10 phút mặc định) và
   `MEDIA_PROBE_AUDIO_PREP_TIMEOUT_MS` (3 phút cho từng lần chạy ffmpeg). Ghi kết
   quả vào ticket #160; nếu gần ngưỡng, tăng giới hạn CPU trước khi bật.

## 5. Bật, kiểm tra và rollback

- **Bật**: đặt `media_probe_audio_prep_enabled: true` rồi chạy deploy `worker`.
- **Kiểm tra sau bật** (không cần secret): upload một MP3 ngắn và một MP4 vài phút
  rồi đối chiếu trong database dev:
  - `ai.media_probe_jobs.status = 'COMPLETED'`;
  - `ai.media_probe_results.decoded_duration_ms` khác `NULL` và gần
    `duration_sec * 1000`;
  - `ai.media_audio_chunks` có đúng `ceil(duration / 600)` hàng (chunk cuối ngắn
    hơn 10 giây được gộp), `object_key` bắt đầu bằng `derived-audio/` và
    `version_id` khác rỗng;
  - log `media_probe_worker.audio_prep.failed` không xuất hiện.
- **Lỗi thường gặp**: nếu thiếu quyền `PutObject`, job kết thúc `FAILED` với
  `MEDIA_AUDIO_PREP_FAILED` (không retry) và log `media_probe_worker.audio_prep.failed`
  có `reason=access_denied`. Kiểm tra mục 2.1. `reason=version_missing` nghĩa là bucket
  chưa bật versioning. Log không chứa key, bucket hay thông điệp thô của S3.
- **Rollback**: đặt cờ về `false` rồi deploy `worker`. Hàng `ai.media_audio_chunks` đã
  ghi vẫn được purge khi xóa Document; object còn lại hết hạn theo lifecycle.

## 6. Giới hạn đã biết

- **Object mồ côi**: nếu worker upload xong nhưng mất fence (Document bị xóa) trước
  khi ghi hàng manifest, `VersionId` đó không có trong purge manifest. Probe không có
  quyền Delete theo thiết kế (D4), nên object này do lifecycle dọn trong khoảng 3
  ngày. Cửa sổ rủi ro chỉ là một chunk vì manifest được ghi từng chunk, ngay sau khi
  upload.
- **Một lần upload thừa**: nếu worker crash giữa `PutObject` và ghi hàng manifest, lần
  claim sau upload lại cùng key và tạo version mới; version cũ cũng chờ lifecycle.
- Dọn hàng `ai.media_audio_chunks` khi xóa Document dựa vào `ON DELETE CASCADE` từ
  `ai.media_probe_jobs`; `ai.chunks` vẫn để #214.
