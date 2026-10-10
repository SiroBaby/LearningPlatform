# Hợp đồng cleanup GHCR

Schedule (lịch tự động) chạy từ default branch (nhánh mặc định) `main`.

## Hợp đồng sau sửa

Selector không có candidate xuất đúng 0 byte. Không nới lỏng validation bằng cách bỏ qua dòng trống/malformed. Deleter chụp và kiểm tra mọi file/ID cho `learningplatform-api` và `learningplatform-web` trước request DELETE đầu tiên: chỉ file regular/readable, không symlink, ID nguyên dương, không duplicate trong package. List và delete dùng cùng `/users/<owner>/packages/container/<package>/versions`.

Schedule không có candidate kết thúc thành công và không gọi DELETE. Manual không nhập `DELETE` vẫn dry-run (chạy thử không xóa), chỉ đọc hai file allowlist; event khác bị từ chối. Giữ policy (chính sách) 10 version gần nhất, tuổi tối thiểu 30 ngày, bảo vệ digest (mã băm image bất biến) từ Deployment/ReplicaSet. Không mở rộng cleanup sang package Go worker hoặc version không có tag/được operator pin.

Thu thập K3s giữ cách quote JSONPath đã sửa ở main, thêm timeout/keepalive hữu hạn. File được stage (ghi tạm) rồi publish bằng rename chỉ sau mọi query thành công và managed image (image thuộc hai package được quản lý) đều dùng digest bất biến. Transport failure, image mutable hoặc danh sách không có digest phải fail-closed (dừng an toàn), không để file rỗng/partial làm bằng chứng hợp lệ.

Curl giữ retry tạm thời mặc định, tối đa 3 retry, giới hạn thời gian 60 giây, connect timeout 10 giây, request timeout 20 giây; bỏ `--retry-all-errors` để không retry HTTP 401/403. Job có thời hạn 15 phút. Lỗi request vẫn chặn các DELETE tiếp theo.

## Kiểm chứng

```sh
bash deploy/dev/tests/test-select-ghcr-versions.sh
bash deploy/dev/tests/test-delete-ghcr-versions.sh
bash deploy/dev/tests/test-cleanup-ghcr-workflow.sh
python3 deploy/dev/tests/test-ghcr-cleanup-execution.py
shellcheck deploy/dev/delete-ghcr-versions.sh
actionlint -shellcheck= .github/workflows/cleanup-ghcr.yml .github/workflows/cleanup-ghcr-ci.yml
```

Regression (kiểm thử chống tái diễn) chạy selector/deleter thật và trích xuất `run` từ YAML production. SSH mock thực thi remote Bash thật qua Kubernetes mock, xác nhận JSONPath là đúng một argument. Curl mock kiểm tra endpoint/ID, không gọi mạng. CI có quyền đọc repository, không dùng package-write token hoặc SSH credential; không DELETE version thật để thử.
