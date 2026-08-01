# Learning Platform infrastructure baseline

Thư mục này là baseline (mốc cấu hình tối thiểu) hạ tầng K3s một node cho môi trường `learning-platform-dev`. Baseline này tạo workload ứng dụng stateless (không lưu trạng thái) `web`, `api`, `worker`, dựng External Secrets Operator, và tách quyền sở hữu observability (quan sát hệ thống) sang namespace `observability` với Helm chart pin version rõ ràng cho Prometheus, Grafana, Loki và Alloy.

Setup guide: `../docs/deployment/GUIDE-dev-k3s.md`.

Operations runbook: `../docs/deployment/RUNBOOK-dev-k3s.md`.

`web`, `api` và `worker` vẫn giữ contract stateless: không tạo PostgreSQL, không tạo PersistentVolume, PersistentVolumeClaim (PVC), StatefulSet, Terraform, và không mở public ingress cho worker. Ngoại lệ duy nhất là scope `infra/observability/`, nơi chart values hoặc manifest render được phép tạo storage cục bộ cho Prometheus, Grafana và Loki theo contract retention (giữ dữ liệu) có kiểm soát. Trước khi rollout backend đã chọn, baseline vẫn chạy SQL migration hiện có bằng bounded one-shot K3s Job và chặn apply workload nếu Job đó không hoàn tất thành công. `deploy/` Compose còn giữ làm fallback tài liệu tham chiếu, nhưng không còn là nhánh rollback vận hành cho observability đã bị xoá theo nhánh `deleted` trong cutover contract hiện tại.

## Layout

- `ansible/`: bootstrap K3s, ESO, baseline monitoring cũ trên host, và apply workload ứng dụng.
- `k8s/apps.yaml.j2`: template workload `web`/`api`/`worker` pin digest.
- `observability/`: values pin chart cho `kube-prometheus-stack`, `loki`, `alloy`. Đây là source scope duy nhất được phép sở hữu tài nguyên observability stateful.
- `scripts/validate.sh`: static validation (kiểm tra tĩnh) cục bộ, không kết nối host.

## Ownership observability hiện tại

Observability hiện tại không còn được mô tả là “tái dùng Prometheus/Grafana host hiện có” như roadmap cũ. Source of truth (nguồn sự thật) hiện tại nằm trong `infra/ansible/vars/dev.yml` và `infra/observability/*.yml`:

- namespace observability: `observability`
- bootstrap AWS Secret cho observability namespace: `observability-aws-credentials`
- Grafana admin Secret trong cluster: `grafana-admin`
- Helm version pin: `v3.21.3`
- chart pin:
  - `prometheus-community/kube-prometheus-stack` `87.21.0`
  - `grafana-community/loki` `18.7.0`, app `3.7.4`
  - `grafana/alloy` `1.11.0`, app `v1.18.0`

Phần monitoring role Ansible dưới `infra/ansible/roles/monitoring/` vẫn tồn tại để phục vụ baseline host Prometheus cũ. Tuy nhiên Todo 10 này ghi lại contract cắt sang ownership mới: Todo 12 chỉ được tiếp tục sau khi runbook đã có section cutover phá huỷ có điều kiện, manifest allowlist đã được Todo 11 xác minh, và operator đã chạy gate dung lượng fail-closed trước và sau nhánh xoá có điều kiện.

## First bootstrap

Không chạy `kubectl`, K3s installer hoặc Ansible trực tiếp trên VPS. Chạy từ máy operator đã được phê duyệt, sau khi inventory được review.

1. Cài collection pin version cục bộ:

   ```bash
   ansible-galaxy collection install -r infra/ansible/requirements.yml
   ```

2. Tạo file inventory local và thay mọi `REPLACE_WITH_*`:

   ```bash
   cp infra/ansible/inventory/hosts.example.yml infra/ansible/inventory/hosts.yml
   cp infra/ansible/inventory/group_vars/k3s_nodes.yml.example infra/ansible/inventory/group_vars/k3s_nodes.yml
   ```

3. Điền biến source vào đúng chỗ. `group_vars/k3s_nodes.yml` chỉ chứa non-secret runtime contract, path SSM, pin version, digest và tên Secret. Nó không chứa secret value thật.

4. Chạy tag `k3s` trước trên host mới:

   ```bash
   ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
     -i infra/ansible/inventory/hosts.yml \
     infra/ansible/playbooks/site.yml --tags k3s
   ```

5. Sau khi namespace có sẵn, tạo hai bootstrap Secret namespaced bắt buộc cho application baseline:

   - `learning-platform-dev-aws-credentials` trong namespace `learning-platform-dev`, key đúng là `access-key-id`, `secret-access-key`
   - `learning-platform-dev-ghcr` trong namespace `learning-platform-dev`, type đúng là `kubernetes.io/dockerconfigjson`

6. Với observability ownership mới, không tạo tay `observability-aws-credentials`. Workflow dispatch `target=observability` dùng GitHub Environment `dev` làm bootstrap trust anchor và idempotently tạo namespace/Secret trước Ansible. `grafana-admin` vẫn do ESO tạo từ SSM:

   - `grafana-admin` trong namespace `observability`, key đúng theo chart values là `admin-user`, `admin-password`

7. Validate local rồi apply baseline ứng dụng:

   ```bash
   bash infra/scripts/validate.sh
   ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
     -i infra/ansible/inventory/hosts.yml \
     infra/ansible/playbooks/site.yml
   ```

## Secrets, SSM và GitHub Environment

### Source variable và nơi lưu

Runtime secret source chính là AWS SSM Parameter Store. `group_vars/k3s_nodes.yml` chỉ lưu exact path, ví dụ:

- `/learning-platform/dev/db-host`
- `/learning-platform/dev/db-port`
- `/learning-platform/dev/db-user`
- `/learning-platform/dev/db-password`
- `/learning-platform/dev/db-name`
- `/learning-platform/dev/db-ssl-mode`
- `/learning-platform/dev/db-ssl-ca`
- `/learning-platform/dev/object-storage-endpoint`
- `/learning-platform/dev/object-storage-port`
- `/learning-platform/dev/object-storage-region`
- `/learning-platform/dev/object-storage-use-ssl`
- `/learning-platform/dev/object-storage-access-key`
- `/learning-platform/dev/object-storage-secret-key`
- `/learning-platform/dev/object-storage-bucket`
- `/learning-platform/dev/ai-credential-encryption-key`
- `/learning-platform/dev/openai-base-url`
- `/learning-platform/dev/openai-api-key`
- `/learning-platform/dev/openai-model`
- `/learning-platform/dev/swagger-username`
- `/learning-platform/dev/swagger-password`
- `/learning-platform/dev/grafana-admin-user`
- `/learning-platform/dev/grafana-admin-password`

GitHub Secrets và GitHub Variables chỉ dùng để chuyển deployment contract vào workflow. Riêng job `deploy-observability` nhận đúng hai static credential (credential tĩnh) bootstrap ESO; chúng không được chuyển cho application job, artifact, cache hoặc Ansible:

- Variables: `DEV_VPS_HOST`, `DEV_VPS_USER`
- Secrets: `DEV_VPS_SSH_KEY`, `DEV_VPS_KNOWN_HOSTS`
- Chỉ `deploy-observability`: `OBSERVABILITY_AWS_ACCESS_KEY_ID`, `OBSERVABILITY_AWS_SECRET_ACCESS_KEY`

Non-secret deployment contract được đọc trực tiếp từ source `infra/ansible/vars/dev.yml` qua `vars_files` trong playbook. Inventory tạm thời của workflow chỉ chứa host/user; application deployment chỉ thêm selected immutable image overrides.

### Least privilege IAM

Bootstrap IAM cho ESO phải giới hạn quyền `ssm:GetParameter` và `ssm:GetParameters` đúng trên exact parameter ARN đã cấu hình. Nếu `SecureString` dùng customer-managed KMS key, chỉ thêm `kms:Decrypt` cho đúng key ARN đó. Không cấp prefix rộng, không cấp wildcard path, không cấp quyền ghi SSM.

Credential observability phải chỉ đọc `/learning-platform/dev/grafana-admin-user` và `/learning-platform/dev/grafana-admin-password` (cùng exact KMS key ARN nếu cần). Khi rotate/revoke hoặc đổi VPS, cập nhật Environment `dev` rồi rerun workflow `target=observability`; không SSH thủ công để tạo lại Secret. Static credential hiện tại là tradeoff bootstrap; hướng mạnh hơn là GitHub OIDC/workload identity hoặc secret manager short-lived credential.

## Observability chart contract

### Storage và retention

Observability values hiện tại giả định đúng các mức sau:

- Prometheus: `3Gi`, retention `7d`, retention size `2500MB`
- Loki: `2Gi`, retention `72h`
- Grafana: `1Gi`

Tổng storage cục bộ cần dành riêng cho observability là 6Gi. Vì storage class là `local-path`, cần chừa thêm headroom (dung lượng đệm) cho metadata, file system và rollback chart. Runbook dùng ngưỡng block sau cutover là còn tối thiểu 11Gi disk và 2Gi RAM available sau khi dừng legacy stack và sau nhánh xoá có điều kiện. `local-path` không hỗ trợ mở rộng volume tại chỗ một cách an toàn trong contract này. Nếu sizing thiếu, phải dừng rollout và tăng dung lượng host trước, không sửa tay PVC đã tạo.

### Resource assumptions

`infra/ansible/vars/dev.yml` khai báo tổng tài nguyên observability như sau:

- requests tổng: `cpu 785m`, `memory 1266Mi`
- limits tổng: `cpu 2950m`, `memory 2496Mi`

Chart values pin resource chi tiết cho Prometheus, Grafana, Loki, Alloy, Prometheus Operator, config reloaders, kube-state-metrics và node-exporter. Nếu host không còn chỗ cho request tối thiểu này, không được tiếp tục cutover.

### Loki Retain/Retain decision

Trong `infra/observability/loki-values.yml`, cờ `enableStatefulSetAutoDeletePVC: true` là chart flag gây hiểu nhầm nếu đọc tách rời. Quyết định owner hiện tại là chỉ tin vào manifest render cuối cùng. Manifest render phải vẫn thể hiện `whenDeleted: Retain` và `whenScaled: Retain`. Nếu render thực tế mất một trong hai trường này, coi như chart output không đạt contract và không được apply.

## Helm release contract cho observability

Tài liệu này không phát hành script Helm tự chạy. Nhưng contract vận hành phải giữ các điểm sau:

- lần cài observability persistent đầu tiên dùng release riêng cho `monitoring`, `loki`, `alloy`
- lần cài đầu tiên không dùng `--atomic`, không dùng cleanup-on-fail, để tránh Helm tự dọn chart và để lại trạng thái nửa vời khó điều tra
- nếu release đầu tiên fail giữa chừng hoặc để orphan resource, coi là HITL, operator phải dừng, ghi nhận trạng thái từng resource, và dọn theo allowlist hẹp có review
- với healthy upgrade đã có release ổn định, mới được dùng guard rollback tương ứng của Helm
- không dùng `helm uninstall` cho các release observability trong contract này
- không xoá PVC hoặc PV observability bằng wildcard hoặc by-hand cleanup khi chưa qua branch `deleted` của runbook

## Runtime verification nhanh

Sau khi observability ownership mới được cài và cutover xong, operator phải kiểm tra tối thiểu:

```bash
sudo k3s kubectl -n observability get pods
sudo k3s kubectl -n observability get pvc
sudo k3s kubectl -n observability get ingress
sudo k3s kubectl -n observability get svc
sudo k3s kubectl -n observability get events --sort-by=.lastTimestamp
sudo k3s kubectl -n observability get prometheus
sudo k3s kubectl -n observability top pods
df -h /
free -h
curl -fsS http://127.0.0.1:32080/ >/dev/null
```

Grafana datasource trong values đang trỏ tới:

- Prometheus: `http://prometheus-operated.observability.svc.cluster.local:9090`
- Loki: `http://learning-platform-loki.observability.svc.cluster.local:3100`

Các URL này là contract nội bộ để đối chiếu render và runtime query. Chúng không thay thế kiểm tra readiness thật.

## Legacy monitoring cutover

Cutover khỏi legacy monitoring không còn hứa hẹn chạy song song kéo dài một tuần. Contract hiện tại là maintenance downtime có chủ đích. Legacy state machine đã được duyệt là Docker-based, không phải systemd-based. Operator phải lên lịch downtime ngắn để:

1. đọc manifest Todo 11 đã sanitize và xác minh đủ exact Docker container ID/name/image/status/mounts/ports cho `prometheus`, `grafana`, `node-exporter`, `cadvisor`
2. stop đúng 4 container legacy theo ID đã capture
3. vô hiệu route `cadvisor` cũ bằng exact Nginx config path và checksum đã capture
4. chạy gate dung lượng máy để tự chọn nhánh `retained` hoặc `deleted`
5. chỉ xoá typed resource đúng allowlist đã được Todo 11 xác minh: exact container ID, exact image ID không còn consumer ngoài legacy, exact Grafana Docker volume, exact Prometheus bind path

Section lệnh chi tiết, guard từ chối resource lạ, marker bất biến và SHA-256 manifest nằm trong `docs/deployment/RUNBOOK-dev-k3s.md`, mục `Legacy monitoring shutdown and conditional deletion`.

## Static validation

`infra/scripts/validate.sh` hiện kiểm tra:

- workload ứng dụng không được chứa `StatefulSet`, `PersistentVolumeClaim`, `Prometheus`, `Grafana`
- observability scope chỉ được phép chứa explicit Kubernetes manifest stateful trong `infra/observability/`
- với explicit Kubernetes manifest có `kind:` ở top level, validator mới kiểm tra `local-path`, `whenDeleted: Retain`, `whenScaled: Retain`, `resources`, retention của Prometheus
- image phải pin immutable digest
- non-secret runtime contract phải là literal manifest, không đi qua SSM

`infra/scripts/validate.sh` là static validator và không render Helm chart. Semantic validation hiện có là luồng riêng: `infra/scripts/render-observability.sh` yêu cầu Helm local đúng `v3.21.3`, render ba chart pin rồi gọi `infra/scripts/validate-rendered-observability.rb`. Ruby validator là offline pre-render validator cho YAML đã render: nó không tải chart hoặc cài dependency. Có thể chạy wrapper với `--chart-dir` chứa đúng ba chart archive local để tránh truy cập Helm repository.

Workflow `infra-quality` hiện chạy `infra/scripts/validate.sh`, suite fixture `infra/scripts/tests/test-rendered-observability-policy.rb`, và workflow policy; nó không gọi wrapper hoặc render chart qua mạng. Job `deploy-observability` cũng không dùng wrapper này; Ansible thực hiện deployment trên VPS theo chart pin. Vì fixture suite không thay thế một render bằng chart archive thật, operator vẫn phải chạy render/validator với chart pin đã xác minh trước cutover hoặc thay đổi Helm values.
