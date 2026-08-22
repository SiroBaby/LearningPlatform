# Checklist công khai repository

Mục đích của checklist này là xác minh repository có thể chuyển từ private sang public mà không công khai bí mật, dữ liệu cá nhân, chi tiết hạ tầng có thể bị tấn công, hoặc claim vượt quá trạng thái thực tế. Đây là checklist phát hành; không tự động thay đổi visibility, deployment, hay credential.

## Bằng chứng audit hiện tại

- `gitleaks git --redact --log-opts="--all"`: đã quét 159 commit, không phát hiện secret.
- Inventory, group vars và deployment overrides có giá trị môi trường thật đang bị Git ignore; chúng không nằm trong danh sách tracked files dùng để public.
- Các giá trị `learning` và `minioadmin` trong `app/docker-compose.yml` và `app/.env.example` được giới hạn cho local fixture, đã có chú thích rõ và không được dùng làm production credential.
- Không tìm thấy credential production, private key, API token hoặc user data trong tracked files qua lần rà soát hiện tại.
- Vẫn cần owner review thủ công các domain deployment, tài liệu vận hành, issue/PR/artifact và lịch sử Git trước khi đổi visibility.

## 1. Quyền và phạm vi

- [ ] Owner xác nhận repository, branch đang chọn, và thời điểm chuyển public.
- [ ] Owner xác nhận danh sách collaborator, GitHub App, deploy key, và organization access còn phù hợp khi repository public.
- [ ] Xác nhận không có agreement với employer, client, trường học, hoặc bên thứ ba cấm công khai code hay tài liệu này.
- [ ] Xác nhận issue, pull request, discussion, release draft, wiki, và artifact cũ không chứa thông tin cần giữ private.

## 2. Quét secret và dữ liệu nhạy cảm

- [ ] Kiểm tra working tree trước khi release: `git status --short`.
- [ ] Quét toàn bộ Git history bằng secret scanner có redact output, ví dụ `gitleaks git --redact --log-opts="--all"`.
- [ ] Quét tracked files và CI configuration; không chỉ quét branch hiện tại.
- [ ] Kiểm tra thủ công các file environment template, workflow, manifest, script, fixture, log mẫu, screenshot, và document export.
- [ ] Bảo đảm không có API key, password, private key, token, database URI, source document, prompt, model response, dữ liệu người dùng, hostname/IP thật, inventory, hoặc internal URL.
- [ ] Nếu từng có secret trong history: revoke/rotate trước, sau đó dùng quy trình rewrite history được owner phê duyệt. Xóa file ở HEAD không đủ để thu hồi secret đã public.
- [ ] Bật GitHub secret scanning và push protection sau khi repository public nếu gói GitHub của owner hỗ trợ.

## 3. An toàn deployment và CI/CD

- [ ] Kiểm tra workflow chỉ dùng GitHub Secrets, environment protection, hoặc secret manager; không embed giá trị nhạy cảm trong YAML, image, artifact, hay log.
- [ ] Kiểm tra workflow dispatch, environment, registry permission, artifact retention, và collaborator permission theo principle of least privilege (chỉ cấp quyền tối thiểu).
- [ ] Bảo đảm README, runbook, và diagram chỉ dùng tên thành phần tổng quát; không đưa endpoint, topology chi tiết, host, hay đường dẫn secret thật.
- [ ] Xác nhận deployment không tự động chạy chỉ vì ai đó fork repository hoặc mở pull request từ fork.

## 4. Chất lượng tài liệu công khai

- [ ] README mô tả đúng scope hiện tại: PDF/plain text là flow đã triển khai; route frontend mock/prototype được ghi rõ.
- [ ] Diagram khớp với runtime hiện tại: Next.js, NestJS/Node relay, Go worker, PostgreSQL, object storage, và observability.
- [ ] Link trong README đến tài liệu ổn định và không dẫn đến file ignored, scratch, artifact, hay tài liệu nội bộ.
- [ ] Không đưa metric, customer claim, production-SLA, hoặc kết quả benchmark khi chưa có bằng chứng công khai và có thể tái lập.
- [ ] Kiểm tra spelling, Markdown rendering, ba SVG architecture diagram, file source Draw.io, và link từ giao diện GitHub trước khi đổi visibility.

## 5. Dependencies và legal

- [ ] Kiểm tra license của dependency, font, icon, image, sample document, và asset được commit.
- [ ] Xác nhận không commit tài liệu học tập, PDF, screenshot, hay dataset mà owner không có quyền phân phối.
- [ ] Owner chọn license cho repository và thêm file `LICENSE` riêng. Không tự suy đoán license: khi chưa có license, người xem thấy source nhưng mặc nhiên không được cấp quyền tái sử dụng.
- [ ] Kiểm tra README, package metadata, và release note sau khi owner chọn license để tránh mô tả mâu thuẫn.

## 6. Kiểm tra phát hành

- [ ] Chạy các check phù hợp với thay đổi cuối cùng, tối thiểu `git diff --check` và build/test của runtime bị ảnh hưởng.
- [ ] Kiểm tra clone mới trong một thư mục sạch có thể đọc README mà không cần credential hay file local.
- [ ] Mở README trên GitHub và xác minh tất cả Mermaid diagram render, link nội bộ hoạt động, và không có literal escape như `\\n`.
- [ ] Owner review lần cuối danh sách file sẽ public, sau đó thực hiện đổi visibility thủ công.
- [ ] Sau khi public, kiểm tra lại repository bằng tài khoản không có quyền quản trị nếu có thể; xác nhận không có environment, artifact, hay thông tin nội bộ bị lộ.

## Kết quả cần ghi nhận

Ghi lại ngày kiểm tra, branch/commit được review, tool quét đã dùng, kết quả, các phát hiện đã rotate/xử lý, license owner đã chọn, và người phê duyệt. Không ghi giá trị secret, raw log nhạy cảm, hay thông tin người dùng vào bằng chứng phát hành.
