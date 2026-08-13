# GUIDE chuẩn bị dev K3s trên VPS

Mục đích của tài liệu này là giúp owner và operator chuẩn bị đủ input trước khi workflow hoặc runbook vận hành có thể dựng baseline `learning-platform-dev` và observability ownership mới một cách an toàn.

## 1. Checklist cuối cùng

| Hạng mục | Trạng thái cần đạt |
| --- | --- |
| Aiven | Đã có `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, file CA, IP VPS đã được allowlist |
| AWS SSM | Đã tạo đủ exact path cho application runtime và Grafana admin |
| IAM | Đã có IAM bootstrap chỉ đọc đúng parameter ARN cần thiết, không wildcard |
| VPS | Đã có host Debian hoặc Ubuntu, user deploy riêng, SSH key, passwordless sudo, firewall và fingerprint `known_hosts` đã kiểm tra |
| K3s bootstrap Secrets | Đã chuẩn bị 2 Secret cho `learning-platform-dev`; workflow tự tạo/upsert Secret AWS riêng cho `observability` |
| Helm observability | Đã chốt pin `helm`, repo chart, chart version, app version, storage và resource assumptions |
| Local inventory | Đã có `infra/ansible/inventory/hosts.yml` và `infra/ansible/inventory/group_vars/k3s_nodes.yml`, đã thay hết `REPLACE_WITH_*` |
| GitHub Environment | Đã có `DEV_VPS_HOST`, `DEV_VPS_USER`, `DEV_VPS_SSH_KEY`, `DEV_VPS_KNOWN_HOSTS`, và 2 AWS Secret observability |
| Todo 11 input | Đã có manifest kiểm kê legacy monitoring, sanitize xong, chưa chứa resource ngoài allowlist |

## 2. Aiven và DB TLS

### 2.1. Exact SSM path cho DB

| Giá trị runtime | SSM path |
| --- | --- |
| `DB_HOST` | `/learning-platform/dev/db-host` |
| `DB_PORT` | `/learning-platform/dev/db-port` |
| `DB_USER` | `/learning-platform/dev/db-user` |
| `DB_PASSWORD` | `/learning-platform/dev/db-password` |
| `DB_NAME` | `/learning-platform/dev/db-name` |
| `DB_SSL_MODE` | `/learning-platform/dev/db-ssl-mode` |
| `DB_SSL_CA` | `/learning-platform/dev/db-ssl-ca` |

`DB_SSL_MODE` cố định là `verify-ca`. Không commit file CA. Không đưa secret value thật vào `group_vars/k3s_nodes.yml` hoặc GitHub Environment.

### 2.2. Cần nhớ

1. Public IP VPS phải được Aiven allowlist trước khi chạy rollout thật.
2. Runtime contract hiện tại không hạ chuẩn TLS.
3. CA nhiều dòng chỉ được lưu ở AWS SSM `SecureString`, không giữ lại trên VPS sau khi nhập xong.

## 3. AWS SSM source-of-truth

### 3.1. Exact path phải có

| Nhóm | SSM path |
| --- | --- |
| Database | `/learning-platform/dev/db-host`, `/learning-platform/dev/db-port`, `/learning-platform/dev/db-user`, `/learning-platform/dev/db-password`, `/learning-platform/dev/db-name`, `/learning-platform/dev/db-ssl-mode`, `/learning-platform/dev/db-ssl-ca` |
| Object storage | `/learning-platform/dev/object-storage-endpoint`, `/learning-platform/dev/object-storage-port`, `/learning-platform/dev/object-storage-region`, `/learning-platform/dev/object-storage-use-ssl`, `/learning-platform/dev/object-storage-access-key`, `/learning-platform/dev/object-storage-secret-key`, `/learning-platform/dev/object-storage-bucket` |
| AI | `/learning-platform/dev/ai-credential-encryption-key`, `/learning-platform/dev/openai-base-url`, `/learning-platform/dev/openai-api-key`, `/learning-platform/dev/openai-model` |
| Swagger | `/learning-platform/dev/swagger-username`, `/learning-platform/dev/swagger-password` |
| Grafana admin | `/learning-platform/dev/grafana-admin-user`, `/learning-platform/dev/grafana-admin-password` |

### 3.2. Nơi nào giữ gì

| Nơi lưu | Được chứa gì | Không được chứa gì |
| --- | --- | --- |
| AWS SSM | secret runtime thật, CA nhiều dòng, Grafana admin | không dùng wildcard import hoặc prefix import |
| `group_vars/k3s_nodes.yml` | path SSM, digest, host, chart pin, resource/storage assumptions, tên Secret | secret value thật, AWS credential, `.dockerconfigjson`, DB password, CA |
| GitHub Environment `dev` | SSH deploy và trust anchor (điểm tin cậy khởi đầu) cho VPS; `OBSERVABILITY_AWS_ACCESS_KEY_ID`, `OBSERVABILITY_AWS_SECRET_ACCESS_KEY` chỉ cho job `deploy-observability` | runtime application secret, application AWS credential, GHCR token |
| Kubernetes Secret do ESO tạo | bản sao runtime secret trong cluster để pod dùng khi chạy | không xem là nơi nhập tay hoặc backup dài hạn |

## 4. IAM least privilege

IAM bootstrap cho ESO phải giới hạn như sau:

1. Chỉ `ssm:GetParameter`, `ssm:GetParameters`.
2. Resource là exact parameter ARN tương ứng từng path ở trên.
3. Chỉ thêm `kms:Decrypt` nếu `SecureString` dùng customer-managed KMS key, và chỉ cho exact key ARN đó.
4. Không dùng policy wildcard theo prefix `/learning-platform/dev/*` nếu không có review riêng.
5. Credential bootstrap observability chỉ cần `ssm:GetParameter` và `ssm:GetParameters` cho đúng hai ARN: `/learning-platform/dev/grafana-admin-user` và `/learning-platform/dev/grafana-admin-password` (và exact KMS key ARN nếu hai `SecureString` dùng CMK).

## 5. Inventory và GitHub Environment

### 5.1. Local inventory source vars

`infra/ansible/inventory/group_vars/k3s_nodes.yml` phải chứa tối thiểu:

- `k3s_version: v1.31.8+k3s1`
- `k3s_installer_sha256`
- `external_secrets_manifest_url`, `external_secrets_manifest_sha256`
- `kube_state_metrics_manifest_url`, `kube_state_metrics_manifest_sha256`
- `aws_credentials_secret_name`
- `aws_region`
- `ssm_parameter_keys.*`
- `web_image`, `api_image`, `worker_image`
- `ghcr_pull_secret_name`
- `web_public_host`, `api_public_host`
- `phase0_api_base_url`
- `phase0_dev_owner_id`
- `ingress_tls_secret_name`
- `deployment_targets`
- `web_resources`, `api_resources`, `worker_resources`
- `observability_namespace`
- `observability_aws_credentials_secret_name`
- `grafana_admin_secret_name`
- `grafana_public_host: grafana.sirobabycloud.io.vn`
- `grafana_ingress_host: grafana.sirobabycloud.io.vn`
- `helm_version`
- `helm_repositories.*`
- `observability_releases.*`
- `observability_storage.*`
- `observability_resources.*`
- `observability_aggregate_resources.*`

### 5.2. GitHub Environment mapping

| Loại | Tên | Chứa gì |
| --- | --- | --- |
| Variable | `DEV_VPS_HOST` | host hoặc IP VPS |
| Variable | `DEV_VPS_USER` | user deploy |
| Secret | `DEV_VPS_SSH_KEY` | private key SSH riêng cho user deploy |
| Secret | `DEV_VPS_KNOWN_HOSTS` | output `ssh-keyscan -H <vps-host>` sau khi đối chiếu fingerprint |
| Secret | `OBSERVABILITY_AWS_ACCESS_KEY_ID` | access key ID của IAM principal chỉ đọc hai path Grafana admin |
| Secret | `OBSERVABILITY_AWS_SECRET_ACCESS_KEY` | secret access key tương ứng; chỉ dùng trong step bootstrap của `deploy-observability` |
| Source repository | `infra/ansible/vars/dev.yml` | non-secret deployment contract đọc bởi playbook `vars_files` |

Workflow không truyền desired-state blob. Inventory tạm thời chỉ chứa host/user; deployment ứng dụng chỉ truyền image override của target đã chọn với digest bất biến.

TLS cho Grafana vẫn do Nginx trên host terminate. Trước khi deploy, operator phải
provision certificate hiện có theo cơ chế Nginx của host và xác nhận certificate
bao gồm SAN `grafana.sirobabycloud.io.vn`; chỉ cấu hình path certificate/key vào
`nginx_tls_certificate_path` và `nginx_tls_certificate_key_path`. Không tạo TLS
Secret ở Traefik/Kubernetes và không commit certificate hoặc private key.

## 6. Hai namespace bootstrap Secrets

### 6.1. Namespace `learning-platform-dev`

Tạo sau khi tag `k3s` đã tạo namespace:

| Secret | Namespace | Key bắt buộc | Mục đích |
| --- | --- | --- | --- |
| `learning-platform-dev-aws-credentials` | `learning-platform-dev` | `access-key-id`, `secret-access-key` | bootstrap ESO cho application runtime |
| `learning-platform-dev-ghcr` | `learning-platform-dev` | `.dockerconfigjson` | kéo image từ GHCR |

Tên Secret thực tế phải khớp `aws_credentials_secret_name` và `ghcr_pull_secret_name` trong inventory đang dùng.

### 6.2. Namespace `observability`

Không tạo tay AWS Secret này. Với **Actions → Deploy development VPS → Run workflow**, operator phải chọn branch `develop` rồi đặt `target=observability`; chỉ khi workflow run ref là `refs/heads/develop` thì job `deploy-observability` mới tạo/upsert idempotent namespace và Secret trước Ansible. Nếu dispatch từ feature branch thì workflow vẫn có thể chạy classification và infra-quality, nhưng job deploy sẽ bị skip theo policy. Hai credential chỉ đi từ environment đã mask qua stdin SSH vào file tạm quyền chặt, sau đó `kubectl create secret --dry-run=client -o yaml | kubectl apply -f -`; workflow chỉ in metadata type/key, không in value.

| Secret | Namespace | Key bắt buộc | Mục đích |
| --- | --- | --- | --- |
| `observability-aws-credentials` | `observability` | `access-key-id`, `secret-access-key` | workflow tự bootstrap ESO/secret fetch cho observability |
| `grafana-admin` | `observability` | `admin-user`, `admin-password` | credential admin Grafana qua `existingSecret` |

`grafana-admin` phải map về exact SSM path `/learning-platform/dev/grafana-admin-user` và `/learning-platform/dev/grafana-admin-password` ở bước secret delivery được phê duyệt. Không hard-code credential trong values file.

### 6.3. Rotation, revoke và VPS replacement

1. Tạo IAM access key mới, cập nhật đúng hai GitHub Environment `dev` Secrets, rồi rerun workflow từ branch `develop` với `target=observability`.
2. Xác minh workflow báo `type=Opaque`, đúng hai key metadata, và ExternalSecret Grafana `Ready=True`; chỉ sau đó revoke access key cũ.
3. Nếu thay VPS, cập nhật `DEV_VPS_HOST`, `DEV_VPS_USER`, `DEV_VPS_KNOWN_HOSTS` theo host mới và rerun workflow từ branch `develop`. Feature ref không được phép deploy. Không SSH thủ công để tạo lại namespace/Secret.
4. Đây là static credential (credential tĩnh) tối thiểu để GitHub là trust anchor ban đầu cho VPS ngoài. Hướng nâng cấp mạnh hơn là GitHub OIDC/workload identity hoặc secret manager có short-lived credential; chưa thay đổi contract hiện tại.

## 7. Helm chart pin và storage assumptions

### 7.1. Pin chart hiện tại

| Release | Chart | Chart version | App version |
| --- | --- | --- | --- |
| `learning-platform-monitoring` | `prometheus-community/kube-prometheus-stack` | `87.21.0` | theo chart |
| `learning-platform-loki` | `grafana-community/loki` | `18.7.0` | `3.7.4` |
| `learning-platform-alloy` | `grafana/alloy` | `1.11.0` | `v1.18.0` |

Helm binary pin là `v3.21.3`.

### 7.2. Storage assumptions

| Thành phần | Size | Retention | Storage class |
| --- | --- | --- | --- |
| Prometheus | `3Gi` | `7d`, `2500MB` | `local-path` |
| Loki | `2Gi` | `72h` | `local-path` |
| Grafana | `1Gi` | không dùng retention timer riêng | `local-path` |

`local-path` có rủi ro không mở rộng tại chỗ an toàn trong contract này. Nếu sizing thiếu, phải tăng disk host rồi tạo lại kế hoạch, không resize tay PVC để cứu cháy.

### 7.3. Resource assumptions

| Mốc | Giá trị |
| --- | --- |
| Requests tổng observability | `cpu 645m`, `memory 1458Mi` |
| Limits tổng observability | `cpu 3050m`, `memory 2880Mi` |
| Ngưỡng còn trống sau khi dừng legacy stack | `>= 11Gi` disk, `>= 2Gi` RAM available |

Nếu host không đáp ứng, Todo 12 phải chặn.

## 8. Điều cần xác minh cho Todo 11

Todo 11 phải tạo manifest kiểm kê legacy monitoring đã sanitize. Manifest đó là input duy nhất được runbook chấp nhận để bước `deleted` branch có thể chạy. Manifest phải:

1. chỉ chứa allowlist tên legacy `prometheus`, `grafana`, `node-exporter`, `cadvisor`
2. chụp exact Docker legacy state cho từng mục allowlist: immutable `container_id`, `container_name`, `image_id`, `image_ref`, `status`, `mounts`, `ports`
3. chụp exact Grafana Docker volume name và mountpoint, không ghi secret
4. chụp exact Prometheus bind path đã duyệt, tách rõ file và directory dưới root legacy đã duyệt, kèm `device`, `inode`, `type`, `sha256` nếu là file config
5. chụp exact Nginx config path cho route cAdvisor, kèm `sha256`
6. chụp `baseline_docker_inventory_sha256` của inventory Docker read-only tại thời điểm kiểm kê
7. chụp `image_consumer_counts` hoặc dữ liệu đủ để recompute số consumer ngoài legacy cho exact image ID dự định xoá
8. không chứa wildcard, không chứa root rộng như `/`, `/var`, `/etc`, không chứa service hoặc container lạ, không chứa secret
9. có checksum SHA-256 để runbook ghi marker bất biến và bind acknowledgement

### 8.1. Schema tối thiểu được runbook chấp nhận

Manifest Todo 11 tối thiểu phải mang đủ shape sau, với giá trị thật do operator tự kiểm kê:

```json
{
  "manifest_version": 1,
  "baseline_docker_inventory_sha256": "<64-hex>",
  "legacy_containers": {
    "prometheus": {
      "container_id": "<immutable-captured-id>",
      "container_name": "prometheus",
      "image_id": "sha256:<image-id>",
      "image_ref": "<captured-image-ref>",
      "status": "running",
      "ports": ["127.0.0.1:9090->9090/tcp"],
      "mounts": [
        {
          "resource_type": "bind_path",
          "source": "/opt/project/prometheus/prometheus.yml",
          "destination": "/etc/prometheus/prometheus.yml",
          "path_type": "file",
          "device": 0,
          "inode": 0,
          "sha256": "<64-hex>"
        }
      ]
    },
    "grafana": {
      "container_id": "<immutable-captured-id>",
      "container_name": "grafana",
      "image_id": "sha256:<image-id>",
      "image_ref": "<captured-image-ref>",
      "status": "running",
      "ports": ["0.0.0.0:3000->3000/tcp"],
      "mounts": [
        {
          "resource_type": "docker_volume",
          "volume_name": "<exact-grafana-volume-name>",
          "mountpoint": "/var/lib/docker/volumes/<exact-grafana-volume-name>/_data",
          "destination": "/var/lib/grafana"
        }
      ]
    },
    "node-exporter": {
      "container_id": "<immutable-captured-id>",
      "container_name": "node-exporter",
      "image_id": "sha256:<image-id>",
      "image_ref": "<captured-image-ref>",
      "status": "running",
      "ports": ["127.0.0.1:9100->9100/tcp"],
      "mounts": []
    },
    "cadvisor": {
      "container_id": "<immutable-captured-id>",
      "container_name": "cadvisor",
      "image_id": "sha256:<image-id>",
      "image_ref": "<captured-image-ref>",
      "status": "running",
      "ports": ["0.0.0.0:8084->8080/tcp"],
      "mounts": []
    }
  },
  "approved_prometheus_bind_paths": [
    {
      "path": "/opt/project/prometheus/prometheus.yml",
      "path_type": "file",
      "device": 0,
      "inode": 0,
      "sha256": "<64-hex>"
    },
    {
      "path": "/opt/project/prometheus/data",
      "path_type": "directory",
      "device": 0,
      "inode": 0
    }
  ],
  "approved_legacy_roots": [
    "/opt/project/prometheus",
    "/var/lib/docker/volumes/<exact-grafana-volume-name>"
  ],
  "grafana_volume": {
    "volume_name": "<exact-grafana-volume-name>",
    "mountpoint": "/var/lib/docker/volumes/<exact-grafana-volume-name>/_data"
  },
  "cadvisor_route_disable": {
    "path": "/etc/nginx/sites-enabled/<exact-file>",
    "sha256": "<64-hex>"
  },
  "image_consumer_counts": {
    "sha256:<image-id>": 1
  },
  "shared_image_consumers": {
    "sha256:<image-id>": [
      "<exact-non-legacy-consumer-or-empty-list>"
    ]
  },
  "delete_plan": {
    "docker_containers": [
      "<exact-captured-container-id>"
    ],
    "docker_images": [
      "sha256:<exact-image-id>"
    ],
    "docker_volume": "<exact-volume-name>",
    "prometheus_bind_paths": [
      "/opt/project/prometheus/prometheus.yml",
      "/opt/project/prometheus/data"
    ]
  }
}
```

Runbook sẽ reject nếu shape này thiếu, sai type, sai allowlist, hoặc drift so với inventory Docker và path metadata đã capture.

## 9. Điều không còn đúng

Những claim sau được xem là stale và không được dùng tiếp trong tài liệu vận hành mới:

1. observability vẫn do host Prometheus/Grafana sở hữu lâu dài
2. log collector cũ trên host vẫn là đường thu log chính
3. GitHub Environment là nơi chở desired-state blob hoặc secret runtime thật
4. có lời hứa vận hành song song kéo dài một tuần giữa stack cũ và stack mới
5. có thể rollback observability đã bị xoá bằng `docker start` cũ sau branch `deleted`

## 10. Mốc bàn giao sang runbook

GUIDE dừng ở bước chuẩn bị input. Tài liệu này không cung cấp script phá huỷ runnable. Các lệnh Docker stop/remove typed resource, nhánh `retained`/`deleted`, guard ngưỡng dung lượng máy đọc số thật, acknowledgement gắn với `manifest_sha256`, marker bất biến và kiểm tra shared image consumer nằm trong `docs/deployment/RUNBOOK-dev-k3s.md`, mục `Legacy monitoring shutdown and conditional deletion`.
