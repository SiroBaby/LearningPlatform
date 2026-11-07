# RUNBOOK STT cho media ở full-pipeline worker trên dev K3s (#160 PR5)

Tài liệu này dành cho owner trước và sau khi bật `go_worker_media_stt_enabled`.
Mặc định cờ là `false`: không có gì thay đổi cho tới khi owner làm các bước dưới.

## 1. Tính năng này làm gì

- **Dùng để làm gì**: biến lời nói trong MP3/MP4 thành văn bản có mốc thời gian, rồi
  đi tiếp pipeline sẵn có (chunk, generate, validate, persist). Câu hỏi trích dẫn
  Citation dạng `{kind: "time", startSec, endSec}`.
- **Cách chạy** (trong `go-worker`, container thuộc Pod `worker`):
  1. Đọc manifest `ai.media_audio_chunks` của probe result gắn với job; thiếu hoặc
     sai hợp đồng là `MEDIA_AUDIO_NOT_PREPARED` (lỗi nghiệp vụ, không gọi STT).
  2. Với mỗi chunk chưa có checkpoint: kiểm fence, đọc đúng `VersionId` trong
     `derived-audio/`, gọi `POST {STT_BASE_URL}/audio/transcriptions`
     (`model=groq/whisper-large-v3`, `response_format=verbose_json`, `language=vi`),
     rồi ghi kết quả vào `ai.media_stt_chunk_results` trong transaction có
     `lockActiveJob`. Retry kỹ thuật chỉ gọi lại các chunk còn thiếu.
  3. Ghép transcript (bỏ phần trùng ở vùng overlap), gói thành chunk có Locator thời
     gian, sinh tối đa 30 câu hỏi rải đều theo thời gian (concurrency `4`).
  4. Khi job kết thúc (thành công hay thất bại cuối), transaction kết thúc cộng số
     giây đã gửi của mọi attempt, ghi `usage.sttBilledSeconds` /
     `usage.sttUncertainSeconds` vào payload `DocumentProcessingResult`, rồi xóa
     checkpoint.
- **Cách tính số giây**: response của 9router không có `usage`, nên số giây = tổng
  thời lượng file (thân + overlap) của các chunk đã gửi. HTTP 2xx là `billed`; timeout,
  mất kết nối, 408 và 5xx là `uncertain` (Node giữ `HELD` theo ADR-0022); 4xx khác và
  429 là bị từ chối rõ ràng, không tính. Không có fallback sang model hay endpoint khác.
- **Lỗi**: 4xx (trừ 408/429) là `PROVIDER_INCOMPATIBLE` (không retry); 429/408/5xx/timeout
  là `PROVIDER_UNAVAILABLE` (retry kỹ thuật 5 giây, 30 giây, 5 phút rồi DLQ); body 2xx sai
  hợp đồng là `TRANSCRIPTION_OUTPUT_INVALID`; transcript rỗng là `MEDIA_TRANSCRIPT_EMPTY`.
- **Cờ và cấu hình**: `go_worker_media_stt_enabled` (mặc định `false`) render thành
  `AI_MEDIA_STT_ENABLED`. Khi `true` manifest thêm `STT_BASE_URL`, `STT_API_KEY` (secretKeyRef)
  và các hằng số không bí mật `STT_MODEL`, `STT_LANGUAGE`, `STT_REQUEST_TIMEOUT_MS=120000`,
  `STT_CONCURRENCY=3`, `AI_MEDIA_GENERATION_CONCURRENCY=4`. Cờ bật mà thiếu
  `media_probe_audio_prep_enabled` hoặc `media_probe_worker_enabled` thì deploy fail ngay.

Nguồn: `worker/internal/processing/stt_http.go`, `media_stt.go`, `postgres_stt.go`,
`worker/internal/consumer/consumer.go`, migration
`app/src/database/migrations/1787803982000_add_media_stt_chunk_results.up.sql`,
ADR-0032 D1/D6/D9.

## 2. Việc owner cần làm

### 2.1. IAM identity full-pipeline

Thêm vào policy của identity `OBJECT_STORAGE_FULL_PIPELINE_MEDIA_*` (đã có quyền đọc `media/*`):

```json
{
  "Sid": "FullPipelineReadDerivedAudio",
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:GetObjectVersion"],
  "Resource": "arn:aws:s3:::<MEDIA_BUCKET>/derived-audio/*"
}
```

Không thêm `ListBucket` hay quyền ghi/xóa.

### 2.2. Tham số STT

Mặc định ExternalSecret dùng lại hai tham số SSM sẵn có của 9router:
`STT_BASE_URL` lấy từ `openai-base-url` và `STT_API_KEY` lấy từ `openai-api-key`
(base URL phải gồm `/v1`; adapter nối thêm `/audio/transcriptions`). Nếu muốn tách
key riêng, tạo `stt-base-url` / `stt-api-key` trong SSM rồi thêm `stt_base_url` /
`stt_api_key` vào `ssm_parameter_keys` của `vars/dev.yml`; template tự ưu tiên khóa mới.
Việc tách là quyết định của PR7.

### 2.3. Egress tới STT (cần owner xác nhận, repo không đổi chính sách)

- Hiện **không có NetworkPolicy nào chọn Pod `worker`** (chỉ có policy cho
  `media-egress-proxy`, `media-probe-db-egress`, `media-probe-worker` và
  `document-purge-worker`). `go-worker` đã gọi `OPENAI_BASE_URL` trực tiếp ra Internet;
  gọi `STT_BASE_URL` đi cùng đường đó, nên bề mặt egress không đổi nếu hai URL cùng host
  9router. Contract `media-stt-flag-contract.yml` khẳng định bật cờ không thêm hay sửa
  NetworkPolicy nào.
- Đường S3 của chunk audio đi qua `media-egress-proxy` sẵn có
  (`OBJECT_STORAGE_EGRESS_PROXY_URL`); không mở thêm host.
- Nếu owner muốn khóa egress của Pod `worker` (Node relay chung Pod), đó là một thay
  đổi riêng: allowlist đúng host `STT_BASE_URL`, DNS, PostgreSQL, proxy S3 và các đích
  của relay; không mở egress rộng.
- Worker không có preflight STT lúc khởi động (cần clip audio và tốn tiền mỗi lần
  khởi động). Kiểm tra thật bằng mục 3.

## 3. Điều kiện trước khi bật cờ

1. `media_probe_audio_prep_enabled: true` đã chạy ổn (RUNBOOK-media-audio-prep-dev.md);
   `ai.media_audio_chunks` có hàng và `decoded_duration_ms` khác `NULL`.
2. Migration `1787803982000_add_media_stt_chunk_results` đã chạy (cùng lần deploy backend;
   chỉ thêm một bảng, không đổi cột cũ).
3. IAM mục 2.1 đã tạo; secret STT có trong SSM theo mục 2.2.
4. Credit/ví tài khoản test đủ cho video (ADR-0032 D2) và PR2/PR3 (ước tính, settlement)
   đã deploy.
5. Đo thời gian job với một file dài nhất dự kiến: STT (concurrency 3) + sinh tối đa 30
   câu phải nhỏ hơn `AI_WORKER_JOB_TIMEOUT_MS` (10 phút); nếu không đủ, job hết hạn,
   retry kỹ thuật và tiếp tục từ checkpoint (không trả tiền hai lần), nhưng cần ghi nhận.

## 4. Bật, kiểm tra và rollback

- **Bật**: đặt `go_worker_media_stt_enabled: true` rồi chạy deploy `worker`.
- **Kiểm tra sau bật**: upload một MP3 ngắn có tiếng Việt rồi đối chiếu (không cần secret):
  - Document sang `READY`; `ai.chunks.locator->>'kind' = 'time'`, `start_sec`/`end_sec` khác
    `NULL`; câu hỏi có Citation `time`;
  - `ai.media_stt_chunk_results` rỗng sau khi job xong (đã dọn); log
    `worker.media_stt.enabled` có mặt lúc khởi động;
  - payload `DocumentProcessingResult.usage.sttBilledSeconds` gần thời lượng media.
- **Rollback**: đặt cờ về `false` rồi deploy `worker`. Job media đang chạy quay về hành vi
  cũ (không có STT, kết thúc lỗi nghiệp vụ); checkpoint còn lại bị xóa khi Document bị purge
  (FK cascade với probe result).

## 5. Giới hạn đã biết

- Ghi checkpoint thất bại sau khi provider đã trả 2xx (lỗi DB không phải mất fence) không
  được tính vào `sttBilledSeconds`; chunk đó bị gọi lại ở lần retry. Rủi ro thấp, nhỏ hơn
  một chunk (khoảng 10 phút audio) mỗi lần xảy ra.
- Số giây tính theo thời lượng file gửi đi (có overlap 5 giây mỗi phía), lớn hơn thời
  lượng giải mã; ước tính của Node dùng thời lượng giải mã, nên settlement có thể cao hơn
  ước tính vài phần trăm.
- Ngưỡng lọc segment nghi hallucinate theo `no_speech_prob`/`avg_logprob` (ADR-0032) chưa
  làm; hiện chỉ lọc segment rỗng.
- Web chưa hiển thị riêng các mã lỗi mới (`MEDIA_AUDIO_NOT_PREPARED`, `MEDIA_TRANSCRIPT_EMPTY`,
  `TRANSCRIPTION_OUTPUT_INVALID`, `PROVIDER_INCOMPATIBLE`); thuộc PR6.
