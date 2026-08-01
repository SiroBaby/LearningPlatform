# RUNBOOK vận hành dev K3s trên VPS

Tài liệu này dùng sau khi input trong `docs/deployment/GUIDE-dev-k3s.md` đã sẵn sàng. Mục tiêu hiện tại là vận hành baseline `learning-platform-dev` và cutover observability ownership mới mà không để tài liệu tự biến thành script phá huỷ bỏ guard.

## 1. Phạm vi sử dụng

RUNBOOK này dùng cho:

1. bootstrap K3s và baseline ứng dụng
2. kiểm tra runtime health
3. chuẩn bị và xác nhận observability ownership mới
4. maintenance downtime cho cutover legacy monitoring
5. conditional deletion (xoá có điều kiện) sau Todo 11
6. rollback theo nhánh `retained` hoặc `deleted` đúng contract
7. rerun workflow `target=observability` để bootstrap credential observability, không SSH thủ công

## 2. Công cụ local bắt buộc

Máy operator cần có:

1. `ansible`
2. `ansible-core 2.21.2`
3. `ansible-lint`
4. `yamllint`
5. collection `kubernetes.core 5.3.0`
6. `python3`
7. `jq`
8. `sha256sum` hoặc `shasum -a 256`

## 3. Bootstrap sequence cho application baseline

### 3.1. Thứ tự chuẩn

1. `k3s`
2. tạo Secret `learning-platform-dev-aws-credentials`
3. tạo Secret `learning-platform-dev-ghcr`
4. `external_secrets`
5. `applications`

Lưu ý, monitoring role Ansible cũ không còn là mô tả ownership đích cho observability. Nếu vẫn cần dùng nó để đọc dữ liệu host cũ trong giai đoạn chuẩn bị, coi đó là legacy path, không phải target architecture.

### 3.2. Lệnh baseline ứng dụng

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags k3s
```

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags external_secrets
```

```bash
ANSIBLE_CONFIG=infra/ansible/ansible.cfg ansible-playbook \
  -i infra/ansible/inventory/hosts.yml \
  infra/ansible/playbooks/site.yml --tags applications
```

## 4. Runtime health cho application baseline

```bash
sudo k3s kubectl -n learning-platform-dev get pods
sudo k3s kubectl -n learning-platform-dev get deploy,svc,ingress,externalsecret,secretstore
sudo k3s kubectl -n learning-platform-dev rollout status deployment/web --timeout=180s
sudo k3s kubectl -n learning-platform-dev rollout status deployment/api --timeout=180s
sudo k3s kubectl -n learning-platform-dev rollout status deployment/worker --timeout=180s
```

```bash
sudo k3s kubectl -n learning-platform-dev get externalsecret learning-platform-api-runtime -o yaml
sudo k3s kubectl -n learning-platform-dev get externalsecret learning-platform-worker-runtime -o yaml
sudo k3s kubectl -n learning-platform-dev get externalsecret learning-platform-swagger-runtime -o yaml
```

## 5. Observability ownership mới

### 5.1. Release pin phải đúng

| Release | Namespace | Chart | Version |
| --- | --- | --- | --- |
| `learning-platform-monitoring` | `observability` | `prometheus-community/kube-prometheus-stack` | `87.21.0` |
| `learning-platform-loki` | `observability` | `grafana-community/loki` | `18.7.0` |
| `learning-platform-alloy` | `observability` | `grafana/alloy` | `1.11.0` |

### 5.2. Release contract

1. Initial install có persistent volume không dùng `--atomic`.
2. Initial install không dùng cleanup-on-fail.
3. Nếu release đầu tiên bị partial hoặc orphan resource, dừng và xử lý HITL, không ép gỡ toàn bộ release bằng lệnh uninstall của Helm.
4. Healthy upgrade về sau mới được dùng guard rollback tương ứng của Helm.
5. Không xoá PVC hoặc PV observability trong runbook này.
6. Loki chỉ được xem là đạt contract nếu manifest render cuối cùng vẫn có `whenDeleted: Retain` và `whenScaled: Retain`, dù chart values có `enableStatefulSetAutoDeletePVC: true`.

### 5.3. Capacity và query commands

Trước khi đụng tới legacy stack, đo lại host:

```bash
df -h /
free -h
nproc
sudo k3s kubectl -n observability get pods
sudo k3s kubectl -n observability get pvc
sudo k3s kubectl -n observability get ingress
sudo k3s kubectl -n observability top pods
sudo k3s kubectl -n observability get prometheus
sudo k3s kubectl -n observability get svc
```

Ngưỡng tối thiểu để được phép tiếp tục sau khi legacy stack đã dừng:

- disk trống `>= 11Gi`
- RAM available `>= 2Gi`

Nếu đạt cả hai ngưỡng sau khi dừng legacy stack, chọn nhánh `retained` và có thể unblock bước cài observability mới. Nếu thiếu một trong hai ngưỡng, chọn nhánh `deleted`. Sau nhánh `deleted`, gate phải chạy lại; nếu vẫn thiếu ngưỡng thì block Todo 12.

### 5.4. Bootstrap AWS credential cho observability

`deploy-observability` là đường duy nhất để tạo/upsert namespace `observability` và Secret `observability-aws-credentials`. Job chỉ chạy từ workflow dispatch với `target=observability`; GitHub Environment `dev` là bootstrap trust anchor cho VPS ngoài.

Khi credential cần rotate, revoke hoặc VPS thay đổi: cập nhật GitHub Environment theo GUIDE rồi rerun workflow. Không tạo/chỉnh Secret bằng SSH thủ công. Workflow xác minh metadata `Opaque` và đúng hai key `access-key-id`, `secret-access-key`, không in secret data.

## 6. Maintenance window và downtime

Cutover này yêu cầu maintenance downtime có chủ đích. Không còn giả định vận hành song song kéo dài một tuần. Operator phải:

1. thông báo downtime cho người dùng nội bộ
2. chặn thao tác thay đổi hạ tầng ngoài scope trong cửa sổ này
3. thu đủ evidence trước, giữa và sau cutover
4. có manifest Todo 11 đã sanitize sẵn trong máy local

## 7. Legacy monitoring shutdown and conditional deletion

Mục này là contract thực thi để Todo 12 có thể tiếp tục. Tài liệu chỉ cung cấp command template (mẫu lệnh) có guard. Nó không cung cấp một script phá huỷ runnable có thể bỏ qua manifest và ngưỡng.

### 7.1. Input bắt buộc

Operator phải chuẩn bị một manifest Todo 11 đã sanitize, ví dụ `./tmp/todo11-legacy-monitoring-manifest.json`. Manifest này là nguồn sự thật duy nhất cho legacy Docker state machine và phải mang đủ exact metadata đã capture. Shape tối thiểu:

```json
{
  "manifest_version": 1,
  "baseline_docker_inventory_sha256": "<64-hex>",
  "services": ["prometheus", "grafana", "node-exporter", "cadvisor"],
  "legacy_containers": {
    "prometheus": {
      "container_id": "<immutable-id>",
      "container_name": "prometheus",
      "image_id": "sha256:<image-id>",
      "image_ref": "<image-ref>",
      "status": "running",
      "ports": ["127.0.0.1:9090->9090/tcp"],
      "mounts": []
    },
    "grafana": {
      "container_id": "<immutable-id>",
      "container_name": "grafana",
      "image_id": "sha256:<image-id>",
      "image_ref": "<image-ref>",
      "status": "running",
      "ports": ["0.0.0.0:3000->3000/tcp"],
      "mounts": [
        {
          "resource_type": "docker_volume",
          "volume_name": "<exact-volume-name>",
          "mountpoint": "/var/lib/docker/volumes/<exact-volume-name>/_data",
          "destination": "/var/lib/grafana"
        }
      ]
    },
    "node-exporter": {
      "container_id": "<immutable-id>",
      "container_name": "node-exporter",
      "image_id": "sha256:<image-id>",
      "image_ref": "<image-ref>",
      "status": "running",
      "ports": ["127.0.0.1:9100->9100/tcp"],
      "mounts": []
    },
    "cadvisor": {
      "container_id": "<immutable-id>",
      "container_name": "cadvisor",
      "image_id": "sha256:<image-id>",
      "image_ref": "<image-ref>",
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
  "grafana_volume": {
    "volume_name": "<exact-volume-name>",
    "mountpoint": "/var/lib/docker/volumes/<exact-volume-name>/_data"
  },
  "cadvisor_route_disable": {
    "path": "/etc/nginx/sites-enabled/<exact-file>",
    "sha256": "<64-hex>"
  },
  "approved_legacy_roots": [
    "/opt/project/prometheus",
    "/var/lib/docker/volumes/<exact-volume-name>"
  ],
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

Manifest này chỉ là ví dụ shape. Todo 11 phải điền exact ID/path thật. Nếu thiếu bất kỳ trường nào, sai type, sai hash, sai ID, sai mount, sai root hoặc có resource ngoài allowlist, runbook phải dừng trước khi in ra bất kỳ delete command nào.

### 7.2. Guard validate manifest

```bash
MANIFEST='./tmp/todo11-legacy-monitoring-manifest.json'
python3 - <<'PY' "$MANIFEST"
import json, pathlib, re, sys

manifest = pathlib.Path(sys.argv[1])
data = json.loads(manifest.read_text())
allowed = ["prometheus", "grafana", "node-exporter", "cadvisor"]
hex64 = re.compile(r"^[a-f0-9]{64}$")
sha_image = re.compile(r"^sha256:[a-f0-9]{64}$")
services = data.get("services")
if services != allowed:
    raise SystemExit("services must be the exact ordered allowlist")
if data.get("manifest_version") != 1:
    raise SystemExit("manifest_version must be 1")
if not hex64.fullmatch(data.get("baseline_docker_inventory_sha256", "")):
    raise SystemExit("baseline_docker_inventory_sha256 must be 64 hex")
for key in (
    "legacy_containers",
    "approved_prometheus_bind_paths",
    "grafana_volume",
    "cadvisor_route_disable",
    "approved_legacy_roots",
    "image_consumer_counts",
    "shared_image_consumers",
    "delete_plan",
):
    if key not in data:
        raise SystemExit(f"missing required key: {key}")
legacy = data["legacy_containers"]
if sorted(legacy.keys()) != sorted(allowed):
    raise SystemExit("legacy_containers keys must match allowlist")
for name in allowed:
    item = legacy[name]
    if item.get("container_name") != name:
        raise SystemExit(f"container_name drift for {name}")
    if not re.fullmatch(r"^[a-f0-9]{12,64}$", item.get("container_id", "")):
        raise SystemExit(f"invalid container_id for {name}")
    if not sha_image.fullmatch(item.get("image_id", "")):
        raise SystemExit(f"invalid image_id for {name}")
    if item.get("status") not in {"running", "exited"}:
        raise SystemExit(f"invalid status for {name}")
approved_roots = data["approved_legacy_roots"]
if not isinstance(approved_roots, list) or not approved_roots:
    raise SystemExit("approved_legacy_roots must be a non-empty list")
for root in approved_roots:
    if root in {"/", "/var", "/etc"}:
        raise SystemExit("approved_legacy_roots cannot contain broad system roots")
    pure = pathlib.PurePosixPath(root)
    if str(pure) != root or root.endswith("/"):
        raise SystemExit(f"unnormalized approved root: {root}")
for path_entry in data["approved_prometheus_bind_paths"]:
    path_value = path_entry.get("path", "")
    if any(token in path_value for token in ("*", "..", "//")):
        raise SystemExit(f"unsafe prometheus path: {path_value}")
    if path_value in {"/", "/var", "/etc", "/opt", "/opt/project", "/opt/project/prometheus"}:
        raise SystemExit(f"prometheus path is too broad: {path_value}")
    if path_entry.get("path_type") not in {"file", "directory"}:
        raise SystemExit(f"invalid path_type for {path_value}")
    if not isinstance(path_entry.get("device"), int) or not isinstance(path_entry.get("inode"), int):
        raise SystemExit(f"device/inode required for {path_value}")
    if path_entry["path_type"] == "file" and not hex64.fullmatch(path_entry.get("sha256", "")):
        raise SystemExit(f"file path requires sha256: {path_value}")
grafana_volume = data["grafana_volume"]
volume_name = grafana_volume.get("volume_name", "")
if not re.fullmatch(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]+$", volume_name):
    raise SystemExit("grafana_volume.volume_name invalid")
if grafana_volume.get("mountpoint") != f"/var/lib/docker/volumes/{volume_name}/_data":
    raise SystemExit("grafana_volume.mountpoint must match exact Docker volume path")
cadvisor = data["cadvisor_route_disable"]
if not hex64.fullmatch(cadvisor.get("sha256", "")):
    raise SystemExit("cadvisor_route_disable.sha256 must be 64 hex")
cadvisor_path = cadvisor.get("path", "")
if not cadvisor_path.startswith("/etc/nginx/") or any(token in cadvisor_path for token in ("*", "..", "//")):
    raise SystemExit("cadvisor_route_disable.path must be an exact nginx path")
delete_plan = data["delete_plan"]
for container_id in delete_plan.get("docker_containers", []):
    if container_id not in {legacy[name]["container_id"] for name in allowed}:
        raise SystemExit(f"delete_plan docker_containers contains unknown id: {container_id}")
for image_id in delete_plan.get("docker_images", []):
    if image_id not in {legacy[name]["image_id"] for name in allowed}:
        raise SystemExit(f"delete_plan docker_images contains unknown image id: {image_id}")
for path_value in delete_plan.get("prometheus_bind_paths", []):
    if path_value not in {entry['path'] for entry in data['approved_prometheus_bind_paths']}:
        raise SystemExit(f"delete_plan contains unknown bind path: {path_value}")
if delete_plan.get("docker_volume") != volume_name:
    raise SystemExit("delete_plan docker_volume must equal captured grafana volume name")
print("manifest guard passed")
PY
```

Nếu command guard này fail, dừng ngay. Không sửa manifest bằng lệnh xoá nhanh trong cửa sổ cutover.

### 7.3. Ghi checksum và marker mở phiên cutover

```bash
MANIFEST_SHA256="$(shasum -a 256 "$MANIFEST" | awk '{print $1}')"
UTC_NOW="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf 'legacy-monitoring-cutover started_at=%s manifest_sha256=%s\n' "$UTC_NOW" "$MANIFEST_SHA256"
```

Sau khi hoàn tất nhánh `retained` hoặc `deleted`, operator phải ghi lại cùng checksum đó vào evidence bất biến của task. Không đổi manifest giữa chừng rồi tiếp tục bằng checksum mới.

### 7.4. Hàm re-hash và acknowledgement bất biến

Mọi stage mutation phải re-hash manifest ngay trước khi tiếp tục. Acknowledgement không dùng plain `DELETE` nữa mà phải bind vào exact branch text và `manifest_sha256` hiện tại.

```bash
CURRENT_MANIFEST_SHA256() {
  shasum -a 256 "$MANIFEST" | awk '{print $1}'
}

ASSERT_MANIFEST_SHA256() {
  test "$(CURRENT_MANIFEST_SHA256)" = "$MANIFEST_SHA256"
}

ACK_TEXT_FOR_BRANCH() {
  BRANCH="$1"
  printf 'I-ACKNOWLEDGE legacy-monitoring-cutover branch=%s manifest_sha256=%s' "$BRANCH" "$MANIFEST_SHA256"
}
```

### 7.5. Chụp trạng thái trước khi dừng

```bash
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
for name in ("prometheus", "grafana", "node-exporter", "cadvisor"):
    item = data["legacy_containers"][name]
    print(name, item["container_id"], item["container_name"], item["image_id"], item["status"])
PY
df -h /
free -h
sudo ss -ltnp '( sport = :3000 or sport = :8084 or sport = :9090 or sport = :9100 )' || true
```

### 7.6. Stop đúng bốn container legacy trước

Legacy objects là Docker containers, không phải systemd services. Không dùng wildcard name. Không dừng container ngoài allowlist. Mỗi lệnh stop phải lấy exact captured ID từ manifest và assert name/image trước khi chạy.

```bash
ASSERT_MANIFEST_SHA256
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
for name in ("prometheus", "grafana", "node-exporter", "cadvisor"):
    item = data["legacy_containers"][name]
    cid = item["container_id"]
    print(f'docker inspect --type container {cid} --format {{"{{.Name}} {{.Image}} {{.State.Status}}"}}')
    print(f'docker stop --time 30 {cid}')
PY
```

Operator phải chạy từng `docker inspect` trước, đối chiếu `container_name`, `image_id`, `status`, rồi mới chạy đúng `docker stop` cho ID tương ứng. Nếu inspect trả object khác, dừng toàn bộ flow.

### 7.7. Disable cAdvisor route cũ

Đường dẫn cấu hình phải lấy từ manifest Todo 11 đã xác minh và phải khớp checksum đã capture. Chỉ render ví dụ thao tác, không cung cấp script sửa tự động:

```bash
ASSERT_MANIFEST_SHA256
CADVISOR_ROUTE_PATH="$(python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(data['cadvisor_route_disable']['path'])
PY
)"
CADVISOR_ROUTE_SHA256="$(python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(data['cadvisor_route_disable']['sha256'])
PY
)"
test "$(shasum -a 256 "$CADVISOR_ROUTE_PATH" | awk '{print $1}')" = "$CADVISOR_ROUTE_SHA256"
printf 'Disable cAdvisor route in verified file: %s\n' "$CADVISOR_ROUTE_PATH"
sudo editor "$CADVISOR_ROUTE_PATH"
sudo nginx -t
sudo systemctl reload nginx
```

Operator phải sửa đúng đoạn route cAdvisor đã được Todo 11 xác minh. Không search-replace mù, không reload nếu `nginx -t` fail, và không tiếp tục nếu checksum trước sửa không khớp manifest.

### 7.8. Gate dung lượng fail-closed sau khi dừng

Gate này phải đọc số máy từ `df -Pk /` và `/proc/meminfo`, validate integer parsing, rồi tự chọn branch. Không dựa vào việc người vận hành nhìn `df -h` và `free -h`.

```bash
CHECK_CAPACITY_AND_SELECT_BRANCH() {
  DISK_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
  MEM_KB="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  case "$DISK_KB" in ''|*[!0-9]*) return 90 ;; esac
  case "$MEM_KB" in ''|*[!0-9]*) return 91 ;; esac
  test "$DISK_KB" -ge 0 || return 92
  test "$MEM_KB" -ge 0 || return 93
  DISK_OK=false
  MEM_OK=false
  test "$DISK_KB" -ge 11534336 && DISK_OK=true
  test "$MEM_KB" -ge 2097152 && MEM_OK=true
  printf 'disk_kb=%s memavailable_kb=%s disk_ok=%s mem_ok=%s\n' "$DISK_KB" "$MEM_KB" "$DISK_OK" "$MEM_OK"
  if test "$DISK_OK" = true && test "$MEM_OK" = true; then
    printf 'selected_branch=retained\n'
    return 10
  fi
  printf 'selected_branch=deleted\n'
  return 20
}

CHECK_CAPACITY_AND_SELECT_BRANCH
CAPACITY_RC="$?"
test "$CAPACITY_RC" = 10 || test "$CAPACITY_RC" = 20
```

Ý nghĩa kết quả:

- return `10` => đủ `11Gi` disk và `2Gi` RAM available, chọn nhánh `retained`
- return `20` => thiếu ít nhất một ngưỡng, chọn nhánh `deleted`
- return `90-93` => parse hoặc range fail, dừng toàn bộ flow

### 7.9. Check shared image consumers trước khi xoá

Manifest Todo 11 phải liệt kê exact shared image consumer đã xác minh. Chỉ image có recomputed non-legacy consumer count bằng `0` mới được in delete command.

```bash
ASSERT_MANIFEST_SHA256
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
legacy_image_ids = {v['image_id'] for v in data['legacy_containers'].values()}
for image_id in sorted(legacy_image_ids):
    consumers = data['shared_image_consumers'].get(image_id, [])
    declared_count = data['image_consumer_counts'].get(image_id)
    if declared_count is None:
        raise SystemExit(f'missing image_consumer_counts for {image_id}')
    non_legacy_consumers = [item for item in consumers if item]
    print(image_id, 'declared_count=', declared_count, 'non_legacy_consumers=', non_legacy_consumers)
PY
```

Nếu còn consumer ngoài legacy, dừng bước xoá image đó. Không suy đoán, không xoá image shared.

### 7.10. Nhánh retained

Nhánh này dùng khi gate sau stop trả `selected_branch=retained`. Không Docker prune, không `docker rm`, không `docker image rm`, không `docker volume rm`, không `rm -rf` diện rộng.

1. Giữ nguyên Docker container đã stop và mọi typed resource capture trong manifest.
2. Ghi marker rằng legacy service đã dừng nhưng chưa xoá.
3. Nếu rollback nhánh retained là cần thiết, chỉ được exact-start lại container `grafana` hoặc `cadvisor` theo đúng captured container ID, rồi stop lại và re-disable sau khi hoàn tất điều tra.

Ví dụ ghi marker:

```bash
ASSERT_MANIFEST_SHA256
ACK_TEXT="$(ACK_TEXT_FOR_BRANCH retained)"
printf 'Type exact acknowledgement for retained branch: %s\n' "$ACK_TEXT"
read -r ACK_VALUE
test "$ACK_VALUE" = "$ACK_TEXT"
```

### 7.11. Nhánh deleted

Nhánh này chỉ được đi tiếp khi gate sau stop trả `selected_branch=deleted`, manifest hash vẫn khớp, shared image consumer đã được xem lại, và operator chấp nhận tính không thể đảo ngược bằng Docker start cho Grafana hoặc cAdvisor cũ. Sau nhánh `deleted`:

- không Docker start lại stack cũ để lấy Grafana ở port `3000`
- không restore lại cAdvisor qua port `8084`
- rollback chỉ còn nhờ K3s revision, K3s Nginx config hoặc endpoint unavailable trong thời gian khôi phục

Trước khi xoá, bắt buộc hiển thị acknowledgement gắn với exact branch text và `manifest_sha256`:

```bash
ASSERT_MANIFEST_SHA256
ACK_TEXT="$(ACK_TEXT_FOR_BRANCH deleted)"
printf 'IRREVERSIBLE: type exact acknowledgement to continue: %s\n' "$ACK_TEXT"
read -r ACK_VALUE
test "$ACK_VALUE" = "$ACK_TEXT"
```

Sau đó operator chỉ dùng typed delete commands. Không wildcard, không loop broad, không chạy lệnh prune diện rộng của Docker, không gỡ toàn bộ release bằng Helm, và không xoá PVC/PV.

#### 7.11.1. Remove exact Docker containers

```bash
ASSERT_MANIFEST_SHA256
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
for cid in data['delete_plan']['docker_containers']:
    print(f'docker inspect --type container {cid} --format {{"{{.Name}} {{.Image}} {{.State.Status}}"}}')
    print(f'docker rm {cid}')
PY
```

Mỗi `docker rm` chỉ được chạy sau khi `docker inspect` xác nhận đúng exact captured ID đang ở trạng thái `stopped` hoặc `exited`.

#### 7.11.2. Remove exact Docker images

```bash
ASSERT_MANIFEST_SHA256
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
for image_id in data['delete_plan']['docker_images']:
    declared_count = data['image_consumer_counts'][image_id]
    consumers = [item for item in data['shared_image_consumers'].get(image_id, []) if item]
    if declared_count != 0 or consumers:
        raise SystemExit(f'image still has non-legacy consumers: {image_id} -> {consumers}')
    print(f'docker image inspect {image_id} --format {{"{{.Id}}"}}')
    print(f'docker image rm {image_id}')
PY
```

#### 7.11.3. Remove exact Grafana Docker volume

```bash
ASSERT_MANIFEST_SHA256
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
volume_name = data['delete_plan']['docker_volume']
print(f'docker volume inspect {volume_name}')
print(f'docker volume rm {volume_name}')
PY
```

`docker volume rm` chỉ được chạy nếu volume name đúng exact captured name, mountpoint đúng exact captured mountpoint, và không còn consumer container nào.

#### 7.11.4. Remove exact Prometheus bind paths

```bash
ASSERT_MANIFEST_SHA256
python3 - <<'PY' "$MANIFEST"
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
approved = {entry['path']: entry for entry in data['approved_prometheus_bind_paths']}
for path_value in data['delete_plan']['prometheus_bind_paths']:
    entry = approved[path_value]
    print(f'# verify path={path_value} path_type={entry["path_type"]} device={entry["device"]} inode={entry["inode"]}')
    print(f'# only after verification, remove exact path: {path_value}')
PY
```

Filesystem removal chỉ được làm cho exact captured path sau khi operator xác nhận bằng local `stat` rằng path vẫn cùng `device`, `inode`, `path_type`, không phải symlink, không phải parent root rộng, và vẫn nằm dưới exact approved root từ manifest. Không chấp nhận generic `rm -rf` template cho path tùy ý.

### 7.12. Gate dung lượng sau nhánh cuối cùng

```bash
CHECK_CAPACITY_AND_SELECT_BRANCH
FINAL_CAPACITY_RC="$?"
test "$FINAL_CAPACITY_RC" = 10
sudo ss -ltnp '( sport = :3000 or sport = :8084 or sport = :9090 or sport = :9100 )' || true
```

Nếu gate cuối không trả `10`, block Todo 12 và ghi rõ blocker. Không bịa rằng xoá đã đủ.

### 7.13. Marker bất biến sau cutover

Operator phải ghi ít nhất một marker chứa:

- thời điểm UTC
- branch đã chọn: `retained` hoặc `deleted`
- `manifest_sha256`
- kết quả gate cuối

Ví dụ dòng evidence:

```text
legacy-monitoring-cutover finished_at=<UTC> branch=<retained|deleted> manifest_sha256=<sha256> disk_ok=<true|false> mem_ok=<true|false> gate_rc=<10|20|90|91|92|93>
```

## 8. Rollback truth table

| Tình huống | Được phép | Không được phép |
| --- | --- | --- |
| Retained branch | exact-start lại container Grafana hoặc cAdvisor đã capture, rồi stop lại và re-disable sau điều tra | broad restore cả stack hoặc broad re-enable route |
| Deleted branch | rollback qua K3s revision, K3s Nginx config, hoặc chấp nhận endpoint unavailable tạm thời | `docker start` hoặc khôi phục port `3000`/`8084` từ stack đã xoá |

## 9. Các kiểm tra sau cutover

```bash
sudo k3s kubectl -n observability get pods
sudo k3s kubectl -n observability get pvc
sudo k3s kubectl -n observability get ingress
sudo k3s kubectl -n observability get svc
sudo k3s kubectl -n observability top pods
curl -I https://157.66.101.219/
```

Nếu Grafana ingress host thật vẫn qua `grafana.observability.internal`, dùng đúng host hoặc route nội bộ đã xác minh trong môi trường hiện tại. Không ép URL public khác nếu chưa được operator cấu hình DNS hoặc TLS tương ứng.

## 10. Các claim đã bị loại bỏ

Các claim sau không còn được dùng trong runbook:

1. GitHub payload mã hoá một dòng mang runtime secret thật
2. collector log cũ trên host là bắt buộc
3. observability mới là stateless
4. vận hành song song kéo dài một tuần là mặc định
5. sau branch `deleted` vẫn có thể khởi động Docker stack cũ để rollback ngay

## 11. Bằng chứng cần lưu cho DoneClaim

Operator hoặc agent chuẩn bị DoneClaim phải có tối thiểu:

1. kết quả `bash infra/scripts/validate.sh`
2. kết quả doc static checks và link checks cục bộ
3. kết quả guard validate manifest Todo 11
4. `manifest_sha256`
5. evidence trước và sau gate capacity fail-closed
6. branch cutover đã chọn: `retained` hoặc `deleted`
7. xác nhận cleanup fixture âm tính đã xoá, không để lại file tạm trong repo
