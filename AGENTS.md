# Repository Service Map

Repository này chứa nhiều phạm vi độc lập. Không đặt coding rule của một service ở root.

- NestJS backend: xem `app/AGENTS.md`.
- Next.js frontend: xem `web/AGENTS.md`.
- Domain, ADR và PRD ở root `CONTEXT.md` và `docs/` là nguồn tham khảo chung, không phải coding rule cho mọi service.
- Issue cục bộ nằm trong `.scratch/<feature>/issues/`.

## Quy tắc workspace

- Mặc định làm việc trong workspace canonical; chỉ tạo Git worktree riêng khi người dùng yêu cầu rõ ràng hoặc thay đổi đồng thời không thể cô lập an toàn theo cách khác, và phải xóa worktree tạm sau khi công việc được merge hoặc từ bỏ.

## Quản lý công việc trên GitHub Project

- GitHub Project `LearningPlatform` là nguồn sự thật cho việc quản lý công việc đang hoạt động. `CONTEXT.md`, `docs/`, ADR, PRD và `.scratch/` vẫn là nguồn tham khảo về domain, kiến trúc, phạm vi và lịch sử, nhưng không thay thế trạng thái và bằng chứng trên GitHub Project.
- Mọi thay đổi mới về roadmap, phạm vi, quyết định thực thi hoặc kết quả kiểm chứng phải được cập nhật vào ticket và Project tương ứng. Không chỉ cập nhật file tài liệu rồi để trạng thái Project bị cũ.
- Sau khi hoàn tất một phase, dùng tài liệu hiện có làm đầu vào để tạo epic, ticket, dependency và tiêu chí kiểm chứng cho phase kế tiếp trên GitHub Project. Lặp lại quy trình này theo thứ tự roadmap cho đến khi xử lý hết các phase đã định nghĩa.
- Trước khi bắt đầu task, bảo đảm ticket đã nằm trong Project, chuyển `Status` sang `In progress` và đăng comment `ĐANG THỰC HIỆN` nêu rõ phạm vi, cách kiểm tra và giới hạn môi trường.
- Không đăng comment tiến độ thông thường trong khi task đang chạy để tránh làm loãng ticket. Chỉ đăng comment chốt khi task hoàn tất; nếu bị chặn và chưa thể hoàn tất, đăng một comment kết luận blocker nêu rõ điều đang thiếu, ảnh hưởng và hành động tiếp theo. Trạng thái Project phải luôn phản ánh đúng tình trạng thực tế.
- Khi hoàn thành task, đăng comment `HOÀN THÀNH` kèm thay đổi, PR hoặc commit nếu có, lệnh kiểm tra và kết quả, bằng chứng manual/visual/operational liên quan cùng giới hạn còn lại. Chỉ chuyển `Status` sang `Done` khi hoạt động của ticket đã có kết luận và bằng chứng; ticket `HITL` vẫn cần human xác nhận trước khi đóng.
- Chỉ được coi ticket là hoàn thành và đóng issue sau khi thay đổi đã commit/push, GitHub Actions sau push đã thành công, và trạng thái sau push đã được kiểm tra lại; thay đổi mới chỉ ở working tree không đủ điều kiện đóng ticket.
- Nội dung ticket và comment phải dùng tiếng Việt cụ thể, nhất quán với ubiquitous language trong `CONTEXT.md`. Khi một English technical term xuất hiện lần đầu, giải thích ngắn bằng tiếng Việt ngay sau thuật ngữ; tránh từ mơ hồ, diễn đạt trừu tượng hoặc kết luận không có bằng chứng khiến human có thể hiểu sai.

## Chuẩn hóa Pull Request

- Mô tả Pull Request (PR) phải là Markdown hợp lệ, không chứa chuỗi escape literal như `\\n`, heading hỏng, hoặc nội dung lẫn ngôn ngữ/encoding khó đọc.
- PR phải dùng đúng sáu mục theo thứ tự: `Mục tiêu`, `Nguyên nhân`, `Thay đổi`, `Kiểm tra`, `Giới hạn/Rủi ro`, `Rollout/Verification`.
- Mỗi mục phải ghi thông tin cụ thể và có bằng chứng; mục không áp dụng ghi `Không có` thay vì bỏ trống. Chỉ nêu lệnh kiểm tra đã chạy và kết quả thực tế, không biến kế hoạch thành kết quả.
- `Rollout/Verification` phải nêu rõ phạm vi runtime/target, bước rollout tiếp theo, trạng thái đã thực hiện hay chưa, và cách xác nhận sau rollout. Không ghi secret, token, credential, raw log nhạy cảm hoặc dữ liệu người dùng.

## Cải tiến quy tắc sau khi sửa lỗi

- Sau khi sửa một lỗi có nguyên nhân lặp lại được, AI phải cập nhật `AGENTS.md` của service liên quan với quy tắc ngắn gọn, có thể áp dụng lại để ngăn lỗi tái diễn.
- Chỉ ghi nhận bài học đã được xác minh; không thêm quy tắc cho lỗi môi trường tạm thời hoặc trường hợp đơn lẻ không có tính khái quát.

## Deployment

- Fixture Git repository trong deployment shell test phải đặt `user.name=test` và `user.email=test@example.com` bằng local config trước mọi commit, và cleanup chỉ xóa thư mục tạm do fixture tạo khi EXIT/HUP/INT/TERM.

- Với inventory Ansible tùy chỉnh, đặt biến group tại `<inventory-dir>/group_vars/<group>.yml` hoặc nạp bằng `vars_files`; không đặt ở thư mục khác rồi giả định Ansible sẽ tự tìm thấy.
- Trong `ansible.builtin.assert.that`, mọi dấu `-` phải cùng mức thụt lề; YAML có thể gộp dòng lệch một space vào biểu thức trước mà syntax-check vẫn không báo lỗi.
- Remote deploy phải dùng đúng deployment path đã cấu hình xuyên suốt bước upload và execute; không dựa vào default path khác với GitHub Environment.
- Khi đối chiếu source với remote/deploy, phải ghi rõ SHA đang chạy và SHA checked-out, kiểm tra bằng `git show <exact-sha>:<path>` hoặc `git diff <exact-sha>...HEAD`; không suy ra remote từ worktree hay tên branch, và phải report blocker nếu source/deploy bất nhất.
- Chỉ promote release state sau khi toàn bộ service health check pass. Rollback first deployment chỉ được dọn container của candidate, không teardown volume hoặc hạ tầng dùng chung.
- Backend deployment phải để API và worker tự chạy tracked SQL runner tại composition root (điểm khởi tạo chính) trước khi tạo Nest application/context và trước readiness. Runner phải dùng PostgreSQL advisory lock để serialize starter đồng thời, fail-closed khi migration chưa hoàn tất, giữ `synchronize=false`, `migrationsRun=false`, và chỉ cho phép promote release khi mọi rollout được chọn đã healthy.
- Mọi thay đổi schema phải giữ expand/contract compatibility giữa các runtime đang còn chạy trong suốt rollout; không giả định có automatic DB rollback khi pod mới fail sau khi đã áp migration.
- Khi đổi Deployment strategy sang `Recreate`, luôn render `spec.strategy.rollingUpdate: null` để server-side patch xóa field `rollingUpdate` cũ; nếu không Kubernetes sẽ từ chối manifest vì `Recreate` không được đi cùng cấu hình rolling update.
- Với Kubernetes list contract có phần tử định danh như Deployment `env`, `state: present` không tự xóa phần tử legacy khỏi resource hiện hữu; dùng strategic patch delete tường minh và đọc lại/assert contract sau apply, không in Secret data.
- Automatic environment deployment chỉ chạy từ branch môi trường đã chỉ định. Phân loại thay đổi theo runtime và không build, restart hoặc rollback service không bị ảnh hưởng; shared backend change phải chọn mọi runtime backend phụ thuộc.
- Mọi `workflow_dispatch` target mới phải được thêm đồng bộ vào input options, classifier allowlist và production-path regression; action upload artifact phải pin immutable SHA thuộc major còn được GitHub hỗ trợ.
- Tách registry/SSH credential của CI khỏi application runtime credential. Không bake secret vào image; production orchestration ưu tiên workload identity hoặc secret manager thay vì sao chép static key theo node.
- Fail-fast non-secret runtime config phải được khai báo bằng manifest literal rõ ràng và có static check; không đẩy các constant contract như AI provider/capability/transport sang ExternalSecret hoặc SSM.
- SSH chạy bên trong loop đang đọc từ redirected stdin phải dùng `-n`, trừ khi cố ý truyền stdin cho remote command.
- SSH read-only chạy lâu và không phát stdout phải cấu hình bounded keepalive; evidence chỉ được publish sau khi validate bằng atomic move, còn transport failure phải tạo sanitized status riêng thay vì artifact rỗng hoặc partial.
- Với YAML `run: |` chứa Python/heredoc, mọi dòng top-level sau block-strip phải cùng indentation; thêm test trích xuất và thực thi bằng fixture trước khi merge.
- Với SSH bootstrap có `set -u`, chạy remote Bash qua `env -u BASH_ENV bash --noprofile --norc` và fixture phải thực thi payload thật để chặn startup shell/quoted heredoc lỗi trước deploy.
- Khi bootstrap kiểm tra Secret, chỉ đọc type và tên key qua output contract được fixture K3s xác nhận; không đọc, parse hoặc in Secret data values. Với key enumeration dùng exact Go template `{{range $key, $_ := .data}}{{$key}}{{"\n"}}{{end}}`, không dùng JSONPath `range` có khai báo biến.
- Với kube-proxy iptables/nft, NodePort không nhất thiết xuất hiện trong `ss`; preflight phải kiểm exact loopback config, Traefik ready endpoint, rule `KUBE-NODEPORTS`, loopback HTTP thành công và node-address HTTP thất bại. `ss` chỉ là diagnostic.
- Template Ansible được render bằng `lookup('template', ...)` chỉ tồn tại trên controller; preflight phải `delegate_to: localhost`, `become: false`, kiểm file regular/readable và content contract trước mọi Kubernetes/Helm mutation, không kiểm bằng `stat` trên VPS.
- Helm values trong checkout của controller phải được allowlist theo release definition, `stat`/`slurp`/checksum trên controller, rồi stage toàn bộ vào một remote directory do role sở hữu với owner/mode và checksum đã kiểm trước `helm list` hoặc `helm upgrade`; Helm chỉ được nhận staged remote path, không được dùng `role_path` trực tiếp.
- Với template YAML nhiều document, render một lần ở controller bằng `from_yaml_all | list`, assert đủ số lượng/thứ tự/kind/name/namespace và đường dẫn secret allowlist trước mutation; chỉ apply danh sách đã kiểm chứng với `no_log: true`, không dùng `from_yaml`.
- Gate dung lượng observability phải đọc fact `MemAvailable` đã sanitize trực tiếp từ `/proc/meminfo`, kiểm chuỗi KiB chỉ gồm chữ số rồi đổi sang MiB trước assertion `>= 2048`; không dùng `MemFree`/`ansible_memfree_mb`. Giữ disk gate `>= 11Gi`, fail-closed khi value thiếu/malformed và đặt toàn bộ gate trước state machine Helm.
- Mọi lệnh Helm trong deployment state machine, kể cả lệnh read-only như `helm list`, phải nhận explicit `--kubeconfig` từ contract đã cấu hình; regression phải kiểm propagation này trước khi cho phép install/upgrade/rollback.
- Helm first install không được query custom resource do chính chart tạo trước khi release tồn tại; retention gate chỉ áp dụng cho release stateful, còn workload stateless như Alloy vẫn phải fail-closed nếu xuất hiện PVC lạ hoặc release state không healthy.
- Prefix của mọi Helm chart phải khớp chính xác repository alias đã cấu hình. Sau failed `helm upgrade --install`, chỉ ghi sanitized rc/category/fingerprint và read-only release/PVC state; cấm in raw stdout/stderr, tự retry, uninstall hoặc xoá PVC/PV trước HITL.
- Pending-install recovery cho observability chỉ được đi qua workflow/role source-managed đã review, exact `learning-platform-monitoring` revision `1` invariant, một lần `helm uninstall` có `--kubeconfig`, rồi assert lại đúng PVC/PV UID-binding trước immediate reinstall; cấm mọi manual Helm/kubectl mutation, retry, patch hoặc recreate PVC/PV.
- Khi giữ `readOnlyRootFilesystem` cho Helm workload, render regression phải xác nhận mọi runtime state path có writable bounded `emptyDir` riêng và image non-root/sidecar phải có UID/GID numeric explicit; không suy luận identity từ `Config.User` của image.
- PVC observability chỉ được phân loại ownership bằng membership exact của label `app.kubernetes.io/instance` trong `pvc_owner_instances` canonical; không suy luận từ tên, prefix, substring hoặc chuỗi bị Helm rút gọn. Test phải include `state-machine.yml` production với label thực tế.
- Grafana 13 datasource health phải gọi UID API `/api/datasources/uid/:uid/health`; index `/api/datasources` theo `name` và `uid`, không dùng numeric datasource ID API.
- Dependency audit exception phải khóa đồng thời exact advisory URL và exact patched version set; advisory mới hoặc version ngoài allowlist phải fail-closed cho tới khi lockfile được nâng và regression được cập nhật.
