# Build image cho môi trường dev

Workflow `deploy-dev.yml` vẫn nhận push trên `develop` và các target thủ công hiện có. Classifier tiếp tục quyết định runtime được chọn; task này không đổi classifier, các bước triển khai Ansible/K3s hoặc target observability.

## Quan hệ phụ thuộc và đầu ra

`image-quality-gate` giữ nguyên điều kiện kiểm tra chất lượng trước đây: mọi job kiểm tra phải thành công hoặc được bỏ qua theo phân loại. Sau gate, `build-api`, `build-web` và `build-go-worker` chạy song song khi runtime tương ứng được chọn. API và worker NestJS tiếp tục dùng chung image backend.

Ba job gọi `build-image.yml`. Job `build-images` thu thập và kiểm tra digest (mã băm manifest bất biến) cho mọi image được chọn trước khi cung cấp đúng các đầu ra `api_digest`, `web_digest`, `go_worker_digest` cho deploy. Build thất bại, bị hủy hoặc thiếu digest đều chặn deploy.

Context và Dockerfile giữ nguyên: `app`/`app/Dockerfile`, `web`/`web/Dockerfile`, `.`/`worker/Dockerfile`. Kiến trúc là `linux/amd64`, tương ứng runner Ubuntu hiện có; manifest tiếp tục có provenance (thông tin nguồn gốc build) tối thiểu. Tag vẫn là `sha-<commit SHA>` và triển khai vẫn dùng `image@sha256:...`.

## Cache và publish

BuildKit dùng cache (bộ nhớ đệm lớp build) GitHub Actions API v2, với scope (phạm vi riêng) `dev-<runtime>-v1` và `mode=max` để lưu cả lớp trung gian. Cache giữa runtime không ghi đè nhau. Dockerfile, nội dung `COPY`, lockfile và tham số build tham gia cache key của BuildKit; chúng thay đổi thì lớp phụ thuộc được build lại. Khi thay đổi chính sách cache, tăng hậu tố `v1`. Phạm vi truy cập cache giữa nhánh do GitHub Actions quản lý; cache miss vẫn build từ đầu. Không có cache cho inventory hoặc credential triển khai.

Lần build đầu không push registry. Sau đó `publish-image.sh` dùng lại cùng builder, context, Dockerfile, platform, tag và provenance; lần solve tiếp theo sử dụng các lớp vừa build, rồi xuất manifest lên GHCR. Cache export chỉ thực hiện ở bước build đầu, không nằm trong vòng retry (thử lại) publish.

Publish có tối đa ba lần, mỗi lần tối đa 600 giây, nghỉ 10 rồi 20 giây. Chỉ retry khi dòng lỗi xác nhận `failed to push ghcr.io/sirobaby/` cùng HTTP 429/500/502/503/504 hoặc lỗi transport tạm thời trong allowlist. Lỗi xác thực, quyền truy cập, chứng chỉ, build, cache, lỗi chưa phân loại và timeout của toàn lệnh dừng ngay. Hết lượt vẫn trả mã lỗi gốc. Log publish thô chỉ nằm trong thư mục tạm và được xóa; console ghi số lần, mã lỗi và loại lỗi. Digest chỉ được công bố sau push thành công và metadata hợp lệ.

## Kiểm chứng trước merge

Workflow `deploy-workflow-ci.yml` chạy trên push nhánh task và pull request, chỉ có quyền đọc repository, không push image hoặc truy cập dev. Nó chạy actionlint (kiểm tra cú pháp/biểu thức workflow), ShellCheck, regression (kiểm thử chống tái diễn) workflow/classifier và fixture (lệnh giả lập) publish.

```sh
bash deploy/dev/tests/test-deploy-dev-workflow.sh
python3 deploy/dev/tests/test-publish-image.py
shellcheck deploy/dev/publish-image.sh
actionlint -shellcheck=
```

Windows checkout có CRLF cần bản sao kiểm thử LF cho Bash Linux. Không cần sửa định dạng toàn repository để chạy kiểm thử.

## Xác nhận sau rollout

Chỉ sau PR được merge vào `develop`, workflow triển khai mới áp dụng cấu trúc build này. Kiểm tra các build được chọn chạy song song, cache hit/miss, manifest digest được truyền nguyên vẹn vào Ansible và các rollout được chọn healthy. Target chưa được chọn phải được bỏ qua. Không dispatch deploy thủ công chỉ để kiểm tra task này.

Chưa có số đo thời gian thực tế trước/sau trên runner hoặc lỗi GHCR thật được tiêm vào môi trường dev. Với nhiều runtime được chọn, phần build chuyển từ tổng thời gian các build sang thời gian build dài nhất, cộng chi phí khởi tạo runner và thu thập digest; lợi ích cache phải được đo bằng những lần chạy dev sau merge. Kiểm thử fixture chứng minh giới hạn retry và hợp đồng đầu ra, không thay thế bằng chứng rollout.
