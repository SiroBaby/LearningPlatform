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

Kết quả hai worker sẽ được ghi từ Actions trên commit mới sau push. Chưa claim thời gian giảm trước khi có kết quả; tốc độ build song song/cache và rollout dev vẫn cần quan sát sau merge PR #184 vào develop.

## Cleanup GHCR — ticket #185

Bốn lịch chạy tự động thất bại [30735309780](https://github.com/SiroBaby/LearningPlatform/actions/runs/30735309780), [31294348527](https://github.com/SiroBaby/LearningPlatform/actions/runs/31294348527), [31925249729](https://github.com/SiroBaby/LearningPlatform/actions/runs/31925249729), [32616484622](https://github.com/SiroBaby/LearningPlatform/actions/runs/32616484622) đều ở `Delete selected version IDs`, với `selector emitted invalid version ID`; job chỉ mất 12–15 giây. Đây là lỗi hợp đồng candidate, không phải timeout hay build chậm. Các lịch từ 30/8 đến 4/10 thành công không chứng minh mọi nhánh dữ liệu đã đúng.

Cleanup chạy từ default branch (nhánh mặc định) main; build-deploy chạy từ develop. Fix cleanup phải có PR riêng từ main vào main, giữ bản quoting SSH đã sửa tại main SHA `ae2c01b4b3a872e2022c02ff4daab0eea74c3801`. Không đưa toàn bộ develop vào main chỉ để sửa lịch cleanup.

## Next step

Ghi số đo/test count hai worker từ CI trên đúng commit; review/merge PR #184 vào develop rồi quan sát build/cache thực tế. #185 kiểm chứng bằng fixture và CI riêng trước merge main; không chạy DELETE thật để thử.
