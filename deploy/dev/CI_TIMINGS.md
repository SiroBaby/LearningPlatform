# Phân tích thời gian Actions cho #94

Thu thập ngày 10/10/2026 từ API job/step (bước chạy) của GitHub Actions. Thời gian tính bằng `completedAt - startedAt`, đơn vị giây; không cộng các job chạy song song thành thời gian toàn workflow. Mỗi run được đối chiếu theo đúng `headSha`, không suy ra source từ tên nhánh.

## Các run build-deploy thành công

| Run / ngày UTC | SHA | Jest backend | Job backend | Build/push | Apply Ansible | Wait rollout |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| [36312293997](https://github.com/SiroBaby/LearningPlatform/actions/runs/36312293997), 27/9 | `89ba004bc514ea0aef40a70eba3ae8f9afd71fcf` | 191 | 246 | 115 | 193 | 161 |
| [34698670005](https://github.com/SiroBaby/LearningPlatform/actions/runs/34698670005), 12/9 | `e2386692cb263367f60436dcbdf49ba2d2f429b3` | 214 | 266 | 99 | 165 | 51 |
| [34684047513](https://github.com/SiroBaby/LearningPlatform/actions/runs/34684047513), 12/9 | `efd629aea0a86cf2c31a5a81def03e8096ad1f6b` | 208 | 258 | 125 | 158 | 82 |
| [34669088362](https://github.com/SiroBaby/LearningPlatform/actions/runs/34669088362), 12/9 | `c061750771bb535badccb0eed8c0cfe03c41b2b6` | 214 | 279 | 97 | 157 | 50 |
| [34629020744](https://github.com/SiroBaby/LearningPlatform/actions/runs/34629020744), 11/9 | `c4fd627645a352a5e119f75c62b277ba78c82db8` | 178 | 225 | 153 | 227 | 71 |
| [34463241586](https://github.com/SiroBaby/LearningPlatform/actions/runs/34463241586), 10/9 | `39bdae049f5e562ef2434b21cf27c0b482948a77` | 185 | 238 | 155 | 222 | 73 |
| [34458694537](https://github.com/SiroBaby/LearningPlatform/actions/runs/34458694537), 10/9 | `142abee5dcec11a7609326181de2210e8d98b63d` | 184 | 246 | 141 | 217 | 110 |

Jest backend là phần chậm nhất trước build: 178–214 giây, trung vị 191 giây. Build/push là 97–155 giây, trung vị 125 giây; không phải toàn bộ nguyên nhân chậm. Run chỉ chọn web [34015745307](https://github.com/SiroBaby/LearningPlatform/actions/runs/34015745307) có build 46 giây, quality frontend 69 giây và deploy 181 giây, nên không áp dụng kết luận tổng ba image cho mọi target.

Deployment ứng dụng cũng chiếm nhiều thời gian, nhưng #94 không được đổi hành vi triển khai: giữ Ansible, chiến lược rollout, thời hạn và readiness/health gate hiện có. Run [34394502883](https://github.com/SiroBaby/LearningPlatform/actions/runs/34394502883) thất bại sau 188 giây ở wait rollout, dù build 110 giây thành công; retry registry không giải quyết lỗi rollout này. Hai run 10/9 còn có job observability riêng 630/695 giây, phần apply 602/664 giây; đó là luồng hạ tầng riêng, không giảm thời hạn kiểm tra để làm workflow nhanh hơn.

## Ngoại lệ npm/network và audit

Run [33848102067](https://github.com/SiroBaby/LearningPlatform/actions/runs/33848102067), SHA `013c05aabc255902be64c2845016e4d401759787`, ngày 4/9: `npm ci` backend/frontend 424/422 giây; audit backend/frontend 276/421 giây. Backend thực sự dừng vì `Unresolved npm audit findings: minio, stream-json` ở source lịch sử; không được gọi đó là lỗi registry push hoặc bỏ audit để CI xanh.

Thay đổi sau điều tra: `npm ci --no-audit --no-fund` tránh request audit/funding lặp tại bước cài đặt; audit tường minh vẫn chạy sau install, có timeout 180 giây và thất bại thì chặn build/deploy. Không sửa advisory/version allowlist hoặc coi timeout là PASS. Chưa có bằng chứng xác định từng request npm gây spike; đây là giảm công việc trùng và giới hạn thời gian thất bại, không khẳng định đã sửa network.

## Tuning Jest và cách đo

`app/src/test-support/test-db.ts` tạo PostgreSQL Testcontainers độc lập mỗi suite (nhóm kiểm thử), có port được cấp động và cleanup riêng. CI đổi toàn bộ `npm test` từ `--runInBand` sang `--maxWorkers=2`, giới hạn hai process (tiến trình) độc lập. Không lọc/bỏ test, không dùng DB chung và không bật reuse container. Bước E2E chuyên biệt vẫn `--runInBand`; build, spec type-check, audit và MinIO regression giữ nguyên.

Baseline Backend CI tại đúng application source `89ba004bc514ea0aef40a70eba3ae8f9afd71fcf`: [36312294024](https://github.com/SiroBaby/LearningPlatform/actions/runs/36312294024), `npm test -- --runInBand` 223 giây, install 24 giây, audit 2 giây, E2E 13 giây và MinIO 53 giây. Run này là đối chiếu lịch sử, không phải benchmark (thí nghiệm đo hiệu năng) cùng điều kiện runner/network.

### Kết quả hai worker trên Actions (10/10/2026)

PR #184 ở SHA `ffb12cc` (đã merge develop `3c39192`, gồm #188). Cùng một run Backend CI [38031322160](https://github.com/SiroBaby/LearningPlatform/actions/runs/38031322160), chạy hai lần (attempt):

| Attempt | Install | Audit | `npm test -- --maxWorkers=2` | E2E | MinIO | Job backend |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 (job 114152694000) | 30 | 1 | 169 (Jest báo 168,6 giây) | 12 | 28 | 302 |
| 2 (job 114153755291) | 19 | 1 | 122 (Jest báo 121,6 giây) | 9 | 22 | 234 |

Cả hai lần: 98/98 suite, 614/614 test PASS, không có test flaky. Attempt 2 được chạy lại chủ động để có mẫu thứ hai, không phải do lỗi.

Đối chiếu `--runInBand` trên cùng ngày, cùng loại runner:

| Run | SHA | Jest `--runInBand` | Job backend |
| --- | --- | ---: | ---: |
| [38031098420](https://github.com/SiroBaby/LearningPlatform/actions/runs/38031098420) (develop, cùng application source với `ffb12cc`) | `3c39192` | 175 | 275 |
| [38030570432](https://github.com/SiroBaby/LearningPlatform/actions/runs/38030570432) | `f9641b6` | 175 | 266 |
| [38029580980](https://github.com/SiroBaby/LearningPlatform/actions/runs/38029580980) | `1aef364` | 225 | 336 |
| [38027585932](https://github.com/SiroBaby/LearningPlatform/actions/runs/38027585932) | `b2d72b6` | 234 | 368 |
| [38023847423](https://github.com/SiroBaby/LearningPlatform/actions/runs/38023847423) | `8e8245b` | 252 | 417 |
| [38023460848](https://github.com/SiroBaby/LearningPlatform/actions/runs/38023460848) | `1eb25d3` | 170 | 267 |

Nhận xét: hai worker cho 122–169 giây (trung bình 146 giây). Sáu run `--runInBand` cùng ngày cho 170–252 giây (trung vị 200 giây); trung vị lịch sử build-deploy là 191 giây. So với run develop cùng source (175 giây), mức giảm là 6–53 giây. Kết luận: có xu hướng giảm khoảng 25–30% thời gian Jest, nhưng mẫu nhỏ (2 lần) và biên nhiễu của runner lớn (riêng `--runInBand` dao động 82 giây), nên chưa phải benchmark chắc chắn. Install và audit không đổi đáng kể (`npm ci` dao động 13–49 giây theo network). Tốc độ build song song/cache và rollout dev chỉ đo được sau khi PR #184 merge vào develop, vì workflow `deploy-dev.yml` không chạy trên pull request.

## Cài ffmpeg/ffprobe trong CI (10/10/2026)

Nguyên nhân: Backend CI cài `ffmpeg` bằng `sudo apt-get install --yes ffmpeg` (không có `--no-install-recommends`). Run [38032634393](https://github.com/SiroBaby/LearningPlatform/actions/runs/38032634393), SHA `c021cb1`, log apt ghi `99 newly installed` và `Fetched 94.1 MB in 9min 50s (159 kB/s)`: mirror Ubuntu chậm, kéo cả dependency đồ họa/âm thanh không cần. Go worker CI cùng ngày chỉ mất 17 giây cho bước apt tương tự, nên thời gian phụ thuộc mirror, không ổn định.

Thay đổi: mọi job cần ffmpeg/ffprobe gọi `worker/scripts/install-media-tools.sh`. Script đọc pin `FFPROBE_*` trong `worker/Dockerfile` (cùng artifact BtbN của image media-probe), kiểm SHA-256 trước khi giải nén, kiểm version binary sau khi giải nén rồi mới thêm vào `PATH`. Không còn `apt-get install ffmpeg` trong workflow; `deploy/dev/tests/test-media-tools-ci.sh` chặn tái diễn. Test ffprobe thật (demuxer allowlist, `CI=true` bắt buộc có binary) và E2E MinIO vẫn chạy; E2E dò version từ binary nên khớp `8.1.3-16-ge0a878dd70-20261009`.

| Run | SHA | Bước cài ffmpeg/ffprobe | Job |
| --- | --- | ---: | ---: |
| Backend CI [38032634393](https://github.com/SiroBaby/LearningPlatform/actions/runs/38032634393) (trước, apt) | `c021cb1` | 603 | 803 |
| Backend CI [38035033998](https://github.com/SiroBaby/LearningPlatform/actions/runs/38035033998) (sau, artifact pin) | `0edbe6c` | 8 | 265 |
| Go worker CI [38032428328](https://github.com/SiroBaby/LearningPlatform/actions/runs/38032428328) (trước, apt `--no-install-recommends`) | `007145e` | 17 | — |
| Go worker CI [38035034020](https://github.com/SiroBaby/LearningPlatform/actions/runs/38035034020) (sau) | `0edbe6c` | 9 | 108 |

Job Backend giảm 538 giây (khoảng 9 phút) trong cặp run này; Jest hai worker ở run sau là 153 giây, nằm trong dải đã đo ở trên. Giới hạn: artifact tải từ GitHub Release của BtbN; nếu release bị xóa thì cả build image media-probe lẫn CI sẽ fail-closed, cần nâng pin trong `worker/Dockerfile`.

## Build song song sau merge (10/10/2026)

Merge PR #184 (`e6b79ad`), run [38045911082](https://github.com/SiroBaby/LearningPlatform/actions/runs/38045911082), FAIL tại `Collect selected image digests`. Lần push đó không đổi web nên `Frontend quality` bị skip hợp lệ. `success()` ngầm định của các job `build-*` xét mọi ancestor bắc cầu, nên cả bốn build bị skip và collector fail-closed (dừng an toàn); không có deploy. PR #195 (`d53552c`) sửa bằng `always() && needs.image-quality-gate.result == 'success'`. Push của #195 chỉ đổi workflow, nên run [38046678853](https://github.com/SiroBaby/LearningPlatform/actions/runs/38046678853) không chọn runtime nào.

Owner cho phép chạy `workflow_dispatch` target `worker` trên `d53552c`, run [38046820045](https://github.com/SiroBaby/LearningPlatform/actions/runs/38046820045): `web=false`, `backend=true`, `go_worker=true`, tức tái hiện đúng ca `Frontend quality` bị skip. Kết quả: SUCCESS; ba build chạy song song, mỗi build publish GHCR thành công ở lần thử đầu; collector PASS; `deployment "worker" successfully rolled out`.

| Job | Bắt đầu–kết thúc (UTC) | Giây | Ghi chú |
| --- | --- | ---: | --- |
| Backend quality | 10:59:50–11:02:32 | 162 | Jest hai worker 113 giây |
| Worker quality | 10:59:50–11:02:02 | 132 | cài ffmpeg/ffprobe pin 12 giây (apt cũ: 17–603 giây) |
| Build api | 11:02:40–11:04:18 | 98 | build 76 giây |
| Build go-worker | 11:02:40–11:04:03 | 83 | build 62 giây |
| Build media-probe | 11:02:40–11:04:21 | 101 | build 80 giây |
| Deploy | 11:04:31–11:09:36 | 305 | Ansible 237 giây, rollout 54 giây |

Pha build kéo dài 101 giây (11:02:40–11:04:21) cho ba image, thay vì tổng 282 giây nếu chạy tuần tự. Trung vị lịch sử của bước build/push tuần tự là 125 giây (với ít image hơn); đây là một mẫu, không phải benchmark. Run này là cold cache (bộ nhớ đệm trống): log có `importing cache manifest from gha` nhưng không có lớp `CACHED` nào, vì đây là lần đầu ghi scope `dev-<runtime>-v1`. Mức lợi của cache cần đo ở các run sau. Toàn workflow mất 600 giây, trong đó deploy chiếm 305 giây; #94 không đổi phần deploy.

## Cleanup GHCR — ticket #185

Bốn lịch chạy tự động thất bại [30735309780](https://github.com/SiroBaby/LearningPlatform/actions/runs/30735309780), [31294348527](https://github.com/SiroBaby/LearningPlatform/actions/runs/31294348527), [31925249729](https://github.com/SiroBaby/LearningPlatform/actions/runs/31925249729), [32616484622](https://github.com/SiroBaby/LearningPlatform/actions/runs/32616484622) đều ở `Delete selected version IDs`, với `selector emitted invalid version ID`; job chỉ mất 12–15 giây. Đây là lỗi hợp đồng candidate, không phải timeout hay build chậm. Các lịch từ 30/8 đến 4/10 thành công không chứng minh mọi nhánh dữ liệu đã đúng.

Cleanup chạy từ default branch (nhánh mặc định) main; build-deploy chạy từ develop. Fix cleanup phải có PR riêng từ main vào main, giữ bản quoting SSH đã sửa tại main SHA `ae2c01b4b3a872e2022c02ff4daab0eea74c3801`. Không đưa toàn bộ develop vào main chỉ để sửa lịch cleanup.

## Next step

Quan sát cache hit của build và Jest hai worker (#194) ở các run build-deploy tiếp theo. #185 kiểm chứng bằng fixture và CI riêng trước merge main; không chạy DELETE thật để thử.
