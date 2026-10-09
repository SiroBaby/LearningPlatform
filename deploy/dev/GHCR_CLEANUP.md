# Điều tra và sửa lịch cleanup GHCR — #185

## Source và bằng chứng lỗi

Schedule (lịch tự động) chạy từ default branch (nhánh mặc định) `main`, không chạy từ `develop`. Đối chiếu source trên đúng run SHA:

- `837b7fdac0eb8f1a9aa6ccb469426bc0980b6a46`: các run [30735309780](https://github.com/SiroBaby/LearningPlatform/actions/runs/30735309780), [31294348527](https://github.com/SiroBaby/LearningPlatform/actions/runs/31294348527), [31925249729](https://github.com/SiroBaby/LearningPlatform/actions/runs/31925249729).
- `ae2c01b4b3a872e2022c02ff4daab0eea74c3801`: run [32616484622](https://github.com/SiroBaby/LearningPlatform/actions/runs/32616484622).

Cả bốn run đều dừng ở `Delete selected version IDs` với `selector emitted invalid version ID`; job mất 12–15 giây. Các lịch từ 30/8 đến 4/10 thành công nhưng dùng cùng logic selector/deleter, nên không chứng minh mọi nhánh dữ liệu đã đúng.

Nguyên nhân tái hiện được: `print(*version_ids, sep="\n")` vẫn in một newline khi `version_ids=[]`. Danh sách không có candidate (version được chọn để xóa) thành file có một dòng trống; deleter yêu cầu mỗi dòng là số nguyên dương nên dừng. Logs không lưu nội dung candidate, vì vậy không khẳng định đã đọc được candidate thật của các run lịch sử; fixture (lệnh/dữ liệu giả lập) tái hiện cùng lỗi từ source trên SHA đó.

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

## Next step

Review/merge PR của #185 vào `main`; không push trực tiếp main/develop và không đưa toàn bộ develop vào main cho fix này. Sau merge xác nhận source SHA của lần schedule kế tiếp và log no-op hoặc exact-ID deletion thành công. Chưa có bằng chứng schedule thật chạy source mới, chưa xác nhận DELETE API bằng mutation thật. #94/PR #184 vào develop theo dõi tối ưu build-deploy riêng.
