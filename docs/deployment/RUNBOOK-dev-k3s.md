# RUNBOOK vận hành dev K3s trên VPS

Tài liệu này bắt đầu từ lúc các điều kiện trong `docs/deployment/GUIDE-dev-k3s.md` đã sẵn sàng và người vận hành chuẩn bị chạy bootstrap hoặc deployment thật.

## 1. Phạm vi sử dụng

RUNBOOK này dùng cho các việc sau:

1. chạy bootstrap Ansible theo tag
2. chạy full baseline lần đầu
3. kiểm tra sức khỏe K3s, ESO, ứng dụng và monitoring
4. smoke test sau deploy
5. rollback theo deployment hoặc digest
6. rotation secret bootstrap và runtime secret
7. chẩn đoán lỗi thường gặp
8. thay VPS mới

GUIDE dừng trước điểm này. Mọi bước bên dưới là thao tác vận hành thật.

## 2. Công cụ local bắt buộc

Máy người vận hành cần có:

1. Homebrew
2. `ansible`
3. `ansible-core 2.21.2`
4. `ansible-lint`
5. `yamllint`
6. collection `kubernetes.core 5.3.0`

Ví dụ cài trên macOS:

```bash
brew install ansible ansible-lint yamllint
ansible-galaxy collection install -r infra/ansible/requirements.yml
```

Kiểm tra nhanh:

```bash
ansible --version
ansible-lint --version
yamllint --version
ansible-galaxy collection list | grep kubernetes.core
```

## 3. Quy tắc bootstrap và thứ tự tag

### 3.1. Trình tự chuẩn

Thứ tự chuẩn cho host mới:

1. `k3s`
2. tạo Secret AWS bootstrap thủ công
3. tạo Secret GHCR pull thủ công
4. `external_secrets`
5. `monitoring`
6. `applications`

Lý do của bước đầu tiên là tag `k3s` tạo namespace `learning-platform-dev`. Hai K8s Secret bắt buộc chỉ được tạo sau khi namespace này tồn tại.

### 3.2. Chạy từng tag

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags k3s
```

Sau khi tag `k3s` xong, tạo hai Secret bootstrap theo GUIDE.

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags external_secrets
```

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags monitoring
```

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags applications
```

### 3.3. Full baseline lần đầu

Sau khi inventory, group vars và hai Secret đã sẵn sàng, chạy validate local rồi apply đầy đủ:

```bash
bash infra/scripts/validate.sh
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml
```

## 4. Check mode và giới hạn của nó

Preview an toàn:

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --check --diff
```

`--check` không chứng minh được các việc sau:

1. tải và chạy installer K3s lần đầu
2. reconcile Kubernetes API thật
3. ESO readiness thật
4. readiness thật của `web`, `api`, `worker`
5. network path thật từ VPS tới Aiven
6. Prometheus scrape thành công thật

Chỉ dùng `--check --diff` để xem render và drift. Không xem nó là bằng chứng bootstrap thành công.

## 5. Runtime verification

### 5.1. Kiểm tra K3s object và rollout

```bash
sudo k3s kubectl -n learning-platform-dev get pods
sudo k3s kubectl -n learning-platform-dev get deploy,svc,ingress,externalsecret,secretstore
sudo k3s kubectl -n learning-platform-dev rollout status deployment/web --timeout=180s
sudo k3s kubectl -n learning-platform-dev rollout status deployment/api --timeout=180s
sudo k3s kubectl -n learning-platform-dev rollout status deployment/worker --timeout=180s
```

### 5.2. Kiểm tra ExternalSecret

```bash
sudo k3s kubectl -n learning-platform-dev get externalsecret learning-platform-api-runtime -o yaml
sudo k3s kubectl -n learning-platform-dev get externalsecret learning-platform-worker-runtime -o yaml
sudo k3s kubectl -n learning-platform-dev get externalsecret learning-platform-swagger-runtime -o yaml
```

Ba resource này phải có `Ready=True`. `learning-platform-swagger-runtime` chỉ chứa hai key `SWAGGER_USERNAME` và `SWAGGER_PASSWORD`, và chỉ API được tham chiếu Secret này.

### 5.3. Kiểm tra host monitoring

Node exporter:

```bash
systemctl status prometheus-node-exporter.service
curl -fsS http://127.0.0.1:9100/metrics | head
```

Nếu host dùng service khác, thay bằng giá trị thật đã khai báo trong `node_exporter_service_name`.

Kube-state-metrics port-forward:

```bash
systemctl status kube-state-metrics-port-forward.service
curl -fsS http://127.0.0.1:18080/metrics | head
```

Port thật phải khớp `kube_state_metrics_port_forward_port`.

Prometheus target:

1. job `node-exporter` phải `up`
2. job `kube-state-metrics` phải `up`
3. target `127.0.0.1:<node_exporter_listen_port>` phải `up`
4. target `127.0.0.1:<kube_state_metrics_port_forward_port>` phải `up`

### 5.4. Kiểm tra private worker

Worker không có public ingress. Kiểm tra service và endpoint:

```bash
sudo k3s kubectl -n learning-platform-dev get svc worker
sudo k3s kubectl -n learning-platform-dev get endpoints worker
```

Port-forward để kiểm tra health:

```bash
sudo k3s kubectl -n learning-platform-dev port-forward svc/worker 3403:3403
```

Từ terminal khác:

```bash
curl -fsS http://127.0.0.1:3403/health
```

### 5.5. Kiểm tra DB env contract mà không in secret

```bash
sudo k3s kubectl -n learning-platform-dev exec deploy/api -- /bin/sh -lc 'test "$DB_SSL_MODE" = "verify-ca" && test -n "$DB_SSL_CA"'
sudo k3s kubectl -n learning-platform-dev exec deploy/worker -- /bin/sh -lc 'test "$DB_SSL_MODE" = "verify-ca" && test -n "$DB_SSL_CA"'
```

## 6. Smoke tests sau deploy

### 6.1. Qua Traefik

HTTP mode chỉ dùng cho health check không chứa credential:

```bash
curl -I http://<dev-public-host>/
curl -fsS http://<dev-public-host>/api/v1/health
```

Nếu đã có TLS secret:

```bash
curl -I https://<dev-public-host>/
curl -fsS https://<dev-public-host>/api/v1/health
```

Swagger Basic Auth chỉ được kiểm tra qua public HTTPS edge đã xác minh certificate. Không truyền credential qua HTTP và không đưa credential trực tiếp vào command line. Dùng file netrc tạm quyền `0600`:

```bash
NETRC_FILE="$(mktemp)"
chmod 600 "$NETRC_FILE"
read -r SWAGGER_USERNAME
read -r -s SWAGGER_PASSWORD
printf 'machine %s login %s password %s\n' '<dev-api-public-host>' "$SWAGGER_USERNAME" "$SWAGGER_PASSWORD" > "$NETRC_FILE"
unset SWAGGER_USERNAME SWAGGER_PASSWORD
curl -fsS -o /dev/null -w '%{http_code}\n' --netrc-file "$NETRC_FILE" "https://<dev-api-public-host>/api/v1/docs"
rm -f -- "$NETRC_FILE"
```

Kết quả phải là `200`. Một request HTTPS không có Basic Auth phải trả `401`. Không dùng `-k` và không log response header chứa thông tin nhạy cảm.

### 6.2. Điều kiện pass tối thiểu

1. `web`, `api`, `worker` rollout thành công
2. `learning-platform-api-runtime`, `learning-platform-worker-runtime` và `learning-platform-swagger-runtime` đều `Ready=True`
3. endpoint `/api/v1/health` trả kết quả thành công
4. worker `/health` trả kết quả thành công qua port-forward
5. target monitoring lên `up`
6. `/api/v1/docs` qua HTTPS trả `401` khi không có credential và `200` với credential đúng

## 7. Rollback

### 7.1. Rollback nhanh theo deployment revision

```bash
sudo k3s kubectl -n learning-platform-dev rollout undo deployment/web
sudo k3s kubectl -n learning-platform-dev rollout undo deployment/api
sudo k3s kubectl -n learning-platform-dev rollout undo deployment/worker
```

Sau rollback nhanh, vẫn phải đưa desired state về digest tốt đã biết.

### 7.2. Rollback chuẩn theo digest cũ

Tạo file override dùng digest cũ:

```yaml
deployment_targets: [web, api, worker]
web_image: ghcr.io/sirobaby/learningplatform-web@sha256:<known-good-web-digest>
api_image: ghcr.io/sirobaby/learningplatform-api@sha256:<known-good-backend-digest>
worker_image: ghcr.io/sirobaby/learningplatform-api@sha256:<known-good-backend-digest>
```

Apply lại phần ứng dụng:

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags applications -e @./overrides-known-good.yml
```

### 7.3. Rollback khi lỗi nằm ở secret hoặc Aiven connectivity

1. khôi phục version parameter cũ trong SSM
2. chờ ESO refresh hoặc restart deployment liên quan
3. chạy lại smoke test
4. nếu cần cửa sổ debug dài, giữ `deploy/` Compose làm fallback tạm thời

## 8. Secret rotation

### 8.1. Rotate AWS bootstrap key cho ESO

1. tạo access key mới cho IAM user bootstrap
2. cập nhật Secret `aws_credentials_secret_name`
3. xác minh `ExternalSecret` vẫn `Ready=True`
4. xóa access key cũ sau khi xác minh xong
5. ghi nhận ngày rotation

Khi thay Secret, tiếp tục dùng file tạm quyền `0600` và `--from-file`. Không chuyển sang `--from-literal`.

### 8.2. Rotate GHCR pull credential

1. tạo token mới
2. replace Secret `ghcr_pull_secret_name`
3. xác minh type vẫn là `kubernetes.io/dockerconfigjson`
4. restart workload nếu cần để kiểm tra image pull
5. revoke token cũ

Tiếp tục dùng password qua stdin và Docker config tạm như trong GUIDE.

### 8.3. Rotate DB password hoặc CA

1. update SSM parameter tương ứng
2. nếu là CA, dùng lại `file://` với file mới
3. xác minh `ExternalSecret` đã sync
4. restart `api` và `worker` để ép reconnect nếu cần
5. chạy lại health check qua Traefik và worker health

### 8.4. Rotate Swagger Basic Auth

1. cập nhật `/learning-platform/dev/swagger-username` và `/learning-platform/dev/swagger-password` trong SSM bằng mẫu `SecureString` của GUIDE
2. xác minh `learning-platform-swagger-runtime` đã sync và vẫn `Ready=True`
3. restart `api` để process nhận credential mới
4. xác minh HTTPS Swagger trả `401` với credential cũ và `200` với credential mới
5. xóa file netrc tạm và không ghi credential vào log hoặc shell history

## 9. Common failure diagnosis

### 9.1. Tag `k3s` fail trước khi cài

Kiểm tra:

1. OS có đúng Debian hoặc Ubuntu không
2. port `80` hoặc `443` có bị service khác chiếm không
3. user SSH có sudo không
4. `k3s_installer_sha256` có đúng không

Lệnh thường dùng:

```bash
cat /etc/os-release
sudo ss -ltnp '( sport = :80 or sport = :443 )'
sudo -l -U <ssh-user>
```

### 9.2. `external_secrets` fail hoặc `Ready=False`

Kiểm tra:

1. Secret AWS bootstrap có đúng tên `aws_credentials_secret_name` không
2. hai key có đúng là `access-key-id` và `secret-access-key` không
3. `aws_region` có đúng không
4. IAM policy có thiếu ARN hoặc thiếu `kms:Decrypt` khi dùng CMK không
5. `ssm_parameter_keys.*` có trỏ đúng exact path không

### 9.3. Ứng dụng không lên dù ESO đã `Ready=True`

Kiểm tra:

1. image có dùng digest immutable không
2. Secret GHCR có đúng type `kubernetes.io/dockerconfigjson` không
3. `ghcr_pull_secret_name` có đúng với Secret thật không
4. `DB_SSL_MODE` có là `verify-ca` và `DB_SSL_CA` có mặt không

### 9.4. Monitoring không lên target

Kiểm tra:

1. `prometheus_service_name` có đúng service thật trên host không
2. `prometheus_config_path` có đúng file config đang dùng không
3. `prometheus_scrape_config_path` và `prometheus_file_sd_target_path` có nằm trong layout thật của host không
4. `promtool` có tồn tại ở `prometheus_promtool_path` không
5. service `kube-state-metrics-port-forward.service` có chạy không

### 9.5. Workflow GitHub fail trước bước Ansible

Kiểm tra environment `dev`:

1. `DEV_VPS_HOST`
2. `DEV_VPS_USER`
3. `DEV_VPS_SSH_KEY`
4. `DEV_VPS_KNOWN_HOSTS`
5. `DEV_K3S_ANSIBLE_VARS_B64`

Kiểm tra thêm:

1. payload base64 có decode được không
2. payload không chứa ký tự xuống dòng lỗi hoặc file sai nội dung
3. user và host chỉ chứa ký tự mà workflow chấp nhận

## 10. VPS replacement sequence

Khi cần thay VPS mới, làm theo đúng thứ tự này:

1. tạo VPS mới với Debian hoặc Ubuntu
2. harden SSH và firewall
3. lấy `known_hosts` của host mới
4. cập nhật inventory local hoặc GitHub Environment sang host mới
5. add public IP mới vào Aiven allowlist
6. giữ host cũ hoạt động cho tới khi host mới pass smoke test
7. chạy tag `k3s` trên host mới
8. tạo Secret AWS bootstrap và Secret GHCR trên host mới
9. chạy `external_secrets`, `monitoring`, `applications` hoặc full baseline theo nhu cầu
10. xác minh Traefik, API health, worker health, Prometheus targets
11. chuyển DNS hoặc endpoint công khai sang host mới nếu cần
12. sau khi host mới ổn định mới gỡ allowlist IP cũ và decommission host cũ

## 11. Mốc kết thúc

Khi một đợt bootstrap hoặc deploy hoàn tất, nên lưu ít nhất các bằng chứng sau:

1. output rollout status của `web`, `api`, `worker`
2. trạng thái `Ready=True` của ba `ExternalSecret`, gồm `learning-platform-swagger-runtime`
3. kết quả health của `http(s)://<dev-public-host>/api/v1/health`
4. kết quả worker `/health` qua port-forward
5. trạng thái target Prometheus `node-exporter` và `kube-state-metrics`
6. kết quả Swagger HTTPS `401` không credential và `200` với credential đúng

Nếu chưa có các bằng chứng này, chưa nên xem rollout là đã xác minh xong.
