# Repository Service Map

Repository này chứa nhiều phạm vi độc lập. Không đặt coding rule của một service ở root.

- NestJS backend: xem `app/AGENTS.md`.
- Next.js frontend: xem `web/AGENTS.md`.
- Domain, ADR và PRD ở root `CONTEXT.md` và `docs/` là nguồn tham khảo chung, không phải coding rule cho mọi service.
- Issue cục bộ nằm trong `.scratch/<feature>/issues/`.

## Quản lý công việc trên GitHub Project

- GitHub Project `LearningPlatform` là nguồn sự thật cho việc quản lý công việc đang hoạt động. `CONTEXT.md`, `docs/`, ADR, PRD và `.scratch/` vẫn là nguồn tham khảo về domain, kiến trúc, phạm vi và lịch sử, nhưng không thay thế trạng thái và bằng chứng trên GitHub Project.
- Mọi thay đổi mới về roadmap, phạm vi, quyết định thực thi hoặc kết quả kiểm chứng phải được cập nhật vào ticket và Project tương ứng. Không chỉ cập nhật file tài liệu rồi để trạng thái Project bị cũ.
- Sau khi hoàn tất một phase, dùng tài liệu hiện có làm đầu vào để tạo epic, ticket, dependency và tiêu chí kiểm chứng cho phase kế tiếp trên GitHub Project. Lặp lại quy trình này theo thứ tự roadmap cho đến khi xử lý hết các phase đã định nghĩa.
- Trước khi bắt đầu task, bảo đảm ticket đã nằm trong Project, chuyển `Status` sang `In progress` và đăng comment `ĐANG THỰC HIỆN` nêu rõ phạm vi, cách kiểm tra và giới hạn môi trường.
- Không đăng comment tiến độ thông thường trong khi task đang chạy để tránh làm loãng ticket. Chỉ đăng comment chốt khi task hoàn tất; nếu bị chặn và chưa thể hoàn tất, đăng một comment kết luận blocker nêu rõ điều đang thiếu, ảnh hưởng và hành động tiếp theo. Trạng thái Project phải luôn phản ánh đúng tình trạng thực tế.
- Khi hoàn thành task, đăng comment `HOÀN THÀNH` kèm thay đổi, PR hoặc commit nếu có, lệnh kiểm tra và kết quả, bằng chứng manual/visual/operational liên quan cùng giới hạn còn lại. Chỉ chuyển `Status` sang `Done` khi hoạt động của ticket đã có kết luận và bằng chứng; ticket `HITL` vẫn cần human xác nhận trước khi đóng.
- Nội dung ticket và comment phải dùng tiếng Việt cụ thể, nhất quán với ubiquitous language trong `CONTEXT.md`. Khi một English technical term xuất hiện lần đầu, giải thích ngắn bằng tiếng Việt ngay sau thuật ngữ; tránh từ mơ hồ, diễn đạt trừu tượng hoặc kết luận không có bằng chứng khiến human có thể hiểu sai.

## Cải tiến quy tắc sau khi sửa lỗi

- Sau khi sửa một lỗi có nguyên nhân lặp lại được, AI phải cập nhật `AGENTS.md` của service liên quan với quy tắc ngắn gọn, có thể áp dụng lại để ngăn lỗi tái diễn.
- Chỉ ghi nhận bài học đã được xác minh; không thêm quy tắc cho lỗi môi trường tạm thời hoặc trường hợp đơn lẻ không có tính khái quát.

## Deployment

- Với inventory Ansible tùy chỉnh, đặt biến group tại `<inventory-dir>/group_vars/<group>.yml` hoặc nạp bằng `vars_files`; không đặt ở thư mục khác rồi giả định Ansible sẽ tự tìm thấy.
- Trong `ansible.builtin.assert.that`, mọi dấu `-` phải cùng mức thụt lề; YAML có thể gộp dòng lệch một space vào biểu thức trước mà syntax-check vẫn không báo lỗi.
- Remote deploy phải dùng đúng deployment path đã cấu hình xuyên suốt bước upload và execute; không dựa vào default path khác với GitHub Environment.
- Chỉ promote release state sau khi toàn bộ service health check pass. Rollback first deployment chỉ được dọn container của candidate, không teardown volume hoặc hạ tầng dùng chung.
- Backend deployment phải chạy tracked SQL migrations từ release image bằng bounded one-shot Job và chờ hoàn tất thành công trước khi apply API hoặc worker; không dựa vào application startup để tự tạo schema.
- Automatic environment deployment chỉ chạy từ branch môi trường đã chỉ định. Phân loại thay đổi theo runtime và không build, restart hoặc rollback service không bị ảnh hưởng; shared backend change phải chọn mọi runtime backend phụ thuộc.
- Tách registry/SSH credential của CI khỏi application runtime credential. Không bake secret vào image; production orchestration ưu tiên workload identity hoặc secret manager thay vì sao chép static key theo node.
- Fail-fast non-secret runtime config phải được khai báo bằng manifest literal rõ ràng và có static check; không đẩy các constant contract như AI provider/capability/transport sang ExternalSecret hoặc SSM.
- SSH chạy bên trong loop đang đọc từ redirected stdin phải dùng `-n`, trừ khi cố ý truyền stdin cho remote command.
- Với YAML `run: |` chứa Python/heredoc, mọi dòng top-level sau block-strip phải cùng indentation; thêm test trích xuất và thực thi bằng fixture trước khi merge.
- Với SSH bootstrap có `set -u`, chạy remote Bash qua `env -u BASH_ENV bash --noprofile --norc` và fixture phải thực thi payload thật để chặn startup shell/quoted heredoc lỗi trước deploy.
- Với kube-proxy iptables/nft, NodePort không nhất thiết xuất hiện trong `ss`; preflight phải kiểm exact loopback config, Traefik ready endpoint, rule `KUBE-NODEPORTS`, loopback HTTP thành công và node-address HTTP thất bại. `ss` chỉ là diagnostic.
