# GUIDE chuẩn bị dev K3s trên VPS
Mục đích của tài liệu này là giúp chủ hệ thống lấy đủ mọi giá trị bắt buộc và khai báo đúng chỗ trước khi GitHub workflow `Deploy development VPS` có thể chạy.

## Checklist cuối cùng
| Hạng mục | Trạng thái cần đạt |
| --- | --- |
| Aiven | Đã có `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, file CA và IP VPS đã được allowlist |
| AWS SSM | Đã tạo đủ 18 parameter đúng tên, đúng type |
| IAM | Đã có IAM user bootstrap, policy chỉ đọc đúng parameter ARN, và một access key đang dùng tạm |
| VPS | Đã có host Debian hoặc Ubuntu, user deploy riêng, SSH key, passwordless sudo, firewall, `known_hosts` đã được kiểm tra fingerprint |
| Prometheus | Đã thu đúng service name, file config, file scrape, file target, port, promtool path, node exporter service và config path |
| Ansible local | Đã tạo `infra/ansible/inventory/hosts.yml` và `infra/ansible/inventory/group_vars/k3s_nodes.yml`, đã thay hết `REPLACE_WITH_*` |
| K3s Secrets | Đã chuẩn bị cách tạo Secret AWS cho ESO và Secret GHCR sau khi tag `k3s` tạo namespace |
| GitHub Environment | Đã có `DEV_VPS_HOST`, `DEV_VPS_USER`, `DEV_VPS_SSH_KEY`, `DEV_VPS_KNOWN_HOSTS`, `DEV_K3S_ANSIBLE_VARS_B64` |

## 1. Lấy thông tin Aiven
### 1.1. Cần lấy gì
| Giá trị | Là gì | Lấy ở đâu | Đưa vào đâu |
| --- | --- | --- | --- |
| `DB_HOST` | Hostname PostgreSQL | Aiven Console, trang service PostgreSQL | SSM `/learning-platform/dev/db-host` |
| `DB_PORT` | Cổng PostgreSQL | Aiven Console, trang service PostgreSQL | SSM `/learning-platform/dev/db-port` |
| `DB_NAME` | Tên database app dùng | Aiven Console hoặc database riêng đã tạo | SSM `/learning-platform/dev/db-name` |
| `DB_USER` | User app dùng để kết nối DB | Aiven Console hoặc user riêng đã tạo | SSM `/learning-platform/dev/db-user` |
| `DB_PASSWORD` | Mật khẩu của user DB | Aiven Console hoặc thông tin user vừa tạo | SSM `/learning-platform/dev/db-password` |
| `DB_SSL_MODE` | Chế độ TLS DB | Cố định là `verify-ca` | SSM `/learning-platform/dev/db-ssl-mode` |
| `DB_SSL_CA` | Nội dung CA certificate nhiều dòng | File CA tải từ Aiven | SSM `/learning-platform/dev/db-ssl-ca` |
| Public IP VPS | IP public của VPS để allowlist | Từ chính VPS | Allowlist của Aiven |

### 1.2. Lấy trực tiếp như thế nào
Kiểm tra public IP từ chính VPS:
```bash
curl -fsS https://ifconfig.me
```
Tạo file local tạm để chứa CA:
```bash
install -d -m 700 ./secrets
touch ./secrets/dev-aiven-ca.pem
chmod 600 ./secrets/dev-aiven-ca.pem
```
Sau đó chép CA tải từ Aiven vào `./secrets/dev-aiven-ca.pem`.

### 1.3. Cần nhớ
Chỉ dùng `DB_SSL_MODE=verify-ca`. Không commit file CA. Không đưa giá trị Aiven thật vào `group_vars/k3s_nodes.yml`. Phải add public IP của VPS vào allowlist trước khi chuyển sang vận hành.

## 2. Tạo tham số AWS SSM
Toàn bộ lệnh trong mục 2.2 đến 2.5 được chạy trên **máy cá nhân dùng để quản trị**, không chạy trên VPS.

Các lệnh AWS CLI gửi dữ liệu trực tiếp từ máy cá nhân lên AWS Systems Manager Parameter Store:

```text
Máy cá nhân quản trị -> AWS CLI -> AWS SSM Parameter Store
```

VPS không nhận và không lưu các biến shell, file request hoặc file CA được dùng trong mục này. Sau khi ghi xong SSM, xóa file tạm trên máy cá nhân theo hướng dẫn bên dưới.

### 2.1. Tên tham số và kiểu dữ liệu
| Tên parameter | Type | Chứa gì |
| --- | --- | --- |
| `/learning-platform/dev/db-host` | `String` | `DB_HOST` |
| `/learning-platform/dev/db-port` | `String` | `DB_PORT` |
| `/learning-platform/dev/db-user` | `SecureString` | `DB_USER` |
| `/learning-platform/dev/db-password` | `SecureString` | `DB_PASSWORD` |
| `/learning-platform/dev/db-name` | `String` | `DB_NAME` |
| `/learning-platform/dev/db-ssl-mode` | `String` | `verify-ca` |
| `/learning-platform/dev/db-ssl-ca` | `SecureString` | nội dung CA nhiều dòng |
| `/learning-platform/dev/object-storage-endpoint` | `String` | endpoint object storage |
| `/learning-platform/dev/object-storage-port` | `String` | port object storage |
| `/learning-platform/dev/object-storage-region` | `String` | region object storage |
| `/learning-platform/dev/object-storage-use-ssl` | `String` | `true` hoặc `false` |
| `/learning-platform/dev/object-storage-access-key` | `SecureString` | access key object storage |
| `/learning-platform/dev/object-storage-secret-key` | `SecureString` | secret key object storage |
| `/learning-platform/dev/object-storage-bucket` | `String` | bucket object storage |
| `/learning-platform/dev/ai-credential-encryption-key` | `SecureString` | key mã hóa credential AI |
| `/learning-platform/dev/openai-base-url` | `String` | base URL provider |
| `/learning-platform/dev/openai-api-key` | `SecureString` | API key provider |
| `/learning-platform/dev/openai-model` | `String` | model name |

### 2.2. Chuẩn bị biến path local
Chạy trên máy cá nhân quản trị. Các biến dưới đây chỉ tồn tại trong phiên terminal hiện tại và chỉ chứa đường dẫn SSM, không chứa secret:

```bash
export AWS_REGION='<aws-region>'
export DB_HOST_PARAM='/learning-platform/dev/db-host'
export DB_PORT_PARAM='/learning-platform/dev/db-port'
export DB_USER_PARAM='/learning-platform/dev/db-user'
export DB_PASSWORD_PARAM='/learning-platform/dev/db-password'
export DB_NAME_PARAM='/learning-platform/dev/db-name'
export DB_SSL_MODE_PARAM='/learning-platform/dev/db-ssl-mode'
export DB_SSL_CA_PARAM='/learning-platform/dev/db-ssl-ca'
export OBJECT_STORAGE_ENDPOINT_PARAM='/learning-platform/dev/object-storage-endpoint'
export OBJECT_STORAGE_PORT_PARAM='/learning-platform/dev/object-storage-port'
export OBJECT_STORAGE_REGION_PARAM='/learning-platform/dev/object-storage-region'
export OBJECT_STORAGE_USE_SSL_PARAM='/learning-platform/dev/object-storage-use-ssl'
export OBJECT_STORAGE_ACCESS_KEY_PARAM='/learning-platform/dev/object-storage-access-key'
export OBJECT_STORAGE_SECRET_KEY_PARAM='/learning-platform/dev/object-storage-secret-key'
export OBJECT_STORAGE_BUCKET_PARAM='/learning-platform/dev/object-storage-bucket'
export AI_CREDENTIAL_ENCRYPTION_KEY_PARAM='/learning-platform/dev/ai-credential-encryption-key'
export OPENAI_BASE_URL_PARAM='/learning-platform/dev/openai-base-url'
export OPENAI_API_KEY_PARAM='/learning-platform/dev/openai-api-key'
export OPENAI_MODEL_PARAM='/learning-platform/dev/openai-model'
```

### 2.3. Ghi giá trị `String`
Chạy trên máy cá nhân quản trị. Đích lưu là AWS SSM Parameter Store, không phải VPS:

```bash
export AIVEN_DB_HOST='<aiven-hostname>'
export AIVEN_DB_PORT='5432'
export AIVEN_DB_NAME='<db-name>'
export DB_SSL_MODE_VALUE='verify-ca'
aws ssm put-parameter --region "$AWS_REGION" --name "$DB_HOST_PARAM" --type String --overwrite --value "$AIVEN_DB_HOST"
aws ssm put-parameter --region "$AWS_REGION" --name "$DB_PORT_PARAM" --type String --overwrite --value "$AIVEN_DB_PORT"
aws ssm put-parameter --region "$AWS_REGION" --name "$DB_NAME_PARAM" --type String --overwrite --value "$AIVEN_DB_NAME"
aws ssm put-parameter --region "$AWS_REGION" --name "$DB_SSL_MODE_PARAM" --type String --overwrite --value "$DB_SSL_MODE_VALUE"
unset AIVEN_DB_HOST AIVEN_DB_PORT AIVEN_DB_NAME DB_SSL_MODE_VALUE
```

### 2.4. Ghi giá trị `SecureString` an toàn
Chạy trên máy cá nhân quản trị. Không truyền secret trực tiếp qua command argument. Dùng file request tạm quyền `0600`; AWS CLI đọc file này và ghi giá trị thẳng vào SSM:

```bash
SSM_REQUEST_FILE="$(mktemp)"
chmod 600 "$SSM_REQUEST_FILE"
trap 'rm -f -- "$SSM_REQUEST_FILE"' EXIT
read -r -s AIVEN_DB_USER
export AIVEN_DB_USER
jq -n --arg name "$DB_USER_PARAM" --arg value "$AIVEN_DB_USER" '{Name:$name,Type:"SecureString",Overwrite:true,Value:$value}' > "$SSM_REQUEST_FILE"
unset AIVEN_DB_USER
aws ssm put-parameter --region "$AWS_REGION" --cli-input-json "file://$SSM_REQUEST_FILE"
read -r -s AIVEN_DB_PASSWORD
export AIVEN_DB_PASSWORD
jq -n --arg name "$DB_PASSWORD_PARAM" --arg value "$AIVEN_DB_PASSWORD" '{Name:$name,Type:"SecureString",Overwrite:true,Value:$value}' > "$SSM_REQUEST_FILE"
unset AIVEN_DB_PASSWORD
aws ssm put-parameter --region "$AWS_REGION" --cli-input-json "file://$SSM_REQUEST_FILE"
rm -f -- "$SSM_REQUEST_FILE"
trap - EXIT
```
Áp dụng cùng mẫu cho `object-storage-access-key`, `object-storage-secret-key`, `ai-credential-encryption-key`, `openai-api-key`.

### 2.5. Ghi CA nhiều dòng
Chạy trên máy cá nhân quản trị. File CA chỉ là file tạm trên máy cá nhân; AWS CLI ghi nội dung file vào SSM `SecureString`:

```bash
export AIVEN_CA_FILE='./secrets/dev-aiven-ca.pem'
aws ssm put-parameter --region "$AWS_REGION" --name "$DB_SSL_CA_PARAM" --type SecureString --overwrite --value file://"$AIVEN_CA_FILE"
rm -f -- "$AIVEN_CA_FILE"
rmdir ./secrets 2>/dev/null || true
unset AIVEN_CA_FILE
```

### 2.6. Cần nhớ
1. Mục 2.2–2.5 chỉ chạy trên máy cá nhân quản trị.
2. Giá trị thật được lưu trong AWS SSM Parameter Store.
3. VPS không giữ file CA, file request hay các biến shell này.
4. `group_vars/k3s_nodes.yml` chỉ chứa đường dẫn của parameter, không chứa giá trị thật.
5. Port, boolean và nội dung nhiều dòng đều được lưu dưới dạng chuỗi trong SSM.

### 2.7. Phân biệt nơi lưu chính và bản sao lúc chạy
AWS SSM là nơi lưu chính của runtime secret. Tuy nhiên, thiết kế hiện tại dùng External Secrets Operator nên K3s sẽ tạo Kubernetes Secret trong cluster để API và worker đọc khi chạy.

Kubernetes Secret này là bản sao do ESO quản lý, không phải nơi nhập hoặc backup secret. Khi chuyển VPS:

1. Không sao chép Kubernetes Secret từ VPS cũ.
2. Dựng K3s trên VPS mới.
3. Tạo lại credential bootstrap cho ESO.
4. ESO đọc lại giá trị từ AWS SSM và tự tạo Kubernetes Secret mới.

Do đó không cần backup hoặc di chuyển runtime secret từ VPS cũ. Nếu yêu cầu là **không được có bất kỳ bản sao secret nào lưu trong K3s datastore trên VPS**, kiến trúc ESO hiện tại không đáp ứng yêu cầu đó và phải đổi sang cơ chế mount secret trực tiếp thay vì tạo Kubernetes Secret.

## 3. Tạo IAM user, policy và access key
### 3.1. Lấy AWS account ID
```bash
aws sts get-caller-identity
```
Lấy giá trị `Account` để điền vào ARN trong policy.

### 3.2. Tạo policy file local an toàn
```bash
POLICY_FILE="$(mktemp)"
chmod 600 "$POLICY_FILE"
cat > "$POLICY_FILE" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadExactSsmParametersOnly",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": [
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-host",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-port",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-user",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-password",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-name",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-ssl-mode",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/db-ssl-ca",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-endpoint",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-port",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-region",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-use-ssl",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-access-key",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-secret-key",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/object-storage-bucket",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/ai-credential-encryption-key",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/openai-base-url",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/openai-api-key",
        "arn:aws:ssm:<aws-region>:<account-id>:parameter/learning-platform/dev/openai-model"
      ]
    }
  ]
}
EOF
```
Nếu `SecureString` dùng customer-managed KMS key riêng, thêm statement `kms:Decrypt` cho đúng key ARN.

### 3.3. Tạo policy, user và gắn policy
```bash
export AWS_REGION='<aws-region>'
export AWS_ACCOUNT_ID='<aws-account-id>'
export IAM_POLICY_NAME='learning-platform-dev-ssm-readonly'
export IAM_USER_NAME='learning-platform-dev-eso-bootstrap'

aws iam create-policy \
  --policy-name "$IAM_POLICY_NAME" \
  --policy-document "file://$POLICY_FILE"

aws iam create-user --user-name "$IAM_USER_NAME"

aws iam attach-user-policy \
  --user-name "$IAM_USER_NAME" \
  --policy-arn "arn:aws:iam::$AWS_ACCOUNT_ID:policy/$IAM_POLICY_NAME"
```

### 3.4. Tạo đúng một access key và giữ tạm an toàn
```bash
ACCESS_KEY_FILE="$(mktemp)"
chmod 600 "$ACCESS_KEY_FILE"
aws iam create-access-key --user-name "$IAM_USER_NAME" > "$ACCESS_KEY_FILE"
```
Mở file này, lấy hai giá trị `AccessKeyId` và `SecretAccessKey`, chép ngay vào nơi giữ bí mật tạm thời để dùng cho Secret AWS ở Bước 7, rồi xóa file local:
```bash
rm -f -- "$ACCESS_KEY_FILE" "$POLICY_FILE"
unset AWS_REGION AWS_ACCOUNT_ID IAM_POLICY_NAME IAM_USER_NAME
```

### 3.5. Cách làm bằng AWS Console nếu không dùng CLI
Vào IAM, tạo policy mới bằng JSON ở trên, tạo user mới, gắn policy, tạo đúng một access key, lưu tạm `Access key ID` và `Secret access key` để dùng ở Bước 7, rồi xóa mọi file local tạm. Không đưa các giá trị này vào GitHub Environment.

## 4. Chuẩn bị user, SSH, sudo và firewall trên VPS
### 4.1. Sinh SSH key trên máy cá nhân
Tạo một cặp key riêng cho tài khoản deploy này, không dùng key cá nhân đang dùng ở nơi khác.
```bash
ssh-keygen -t ed25519 -f ~/.ssh/learning-platform-dev-deploy -C 'learning-platform-dev-deploy'
chmod 600 ~/.ssh/learning-platform-dev-deploy
chmod 644 ~/.ssh/learning-platform-dev-deploy.pub
```
Trong đó, `~/.ssh/learning-platform-dev-deploy` là private key để đưa vào `DEV_VPS_SSH_KEY`, còn `~/.ssh/learning-platform-dev-deploy.pub` là public key để cài lên VPS.

### 4.2. Tạo user deploy riêng trên Ubuntu hoặc Debian
Không dùng root. Không dùng user cá nhân. Phase 0 hiện cần passwordless sudo cho tài khoản riêng này vì workflow chạy Ansible với `become` và còn gọi `sudo k3s kubectl`.

Trên VPS, đăng nhập bằng tài khoản quản trị ban đầu rồi tạo user và thư mục SSH:
```bash
sudo adduser --disabled-password --gecos '' deploylp
sudo install -d -m 700 -o deploylp -g deploylp /home/deploylp/.ssh
```

Từ máy cá nhân, copy public key lên VPS bằng tài khoản quản trị ban đầu:
```bash
scp ~/.ssh/learning-platform-dev-deploy.pub <admin-user>@<vps-host>:/tmp/learning-platform-dev-deploy.pub
```

Quay lại VPS và cài public key cho `deploylp`:
```bash
sudo install -m 600 -o deploylp -g deploylp \
  /tmp/learning-platform-dev-deploy.pub \
  /home/deploylp/.ssh/authorized_keys
rm -f /tmp/learning-platform-dev-deploy.pub
```

Kiểm tra đăng nhập từ máy cá nhân trước khi tiếp tục:
```bash
ssh -i ~/.ssh/learning-platform-dev-deploy deploylp@<vps-host>
```

### 4.3. Tạo file sudoers an toàn
Tạo file `/etc/sudoers.d/learning-platform-deploy`:
```bash
SUDOERS_FILE="$(mktemp)"
chmod 600 "$SUDOERS_FILE"
cat > "$SUDOERS_FILE" <<'EOF'
deploylp ALL=(ALL) NOPASSWD: ALL
EOF
sudo install -m 440 "$SUDOERS_FILE" /etc/sudoers.d/learning-platform-deploy
sudo visudo -cf /etc/sudoers.d/learning-platform-deploy
rm -f -- "$SUDOERS_FILE"
```
Đây là tài khoản deploy riêng cho baseline Phase 0. Passwordless sudo hiện là bắt buộc cho baseline này. Không tái sử dụng user cá nhân hoặc root.

### 4.4. Kiểm tra trực tiếp trên VPS
```bash
cat /etc/os-release
sudo -l -U deploylp
sudo ss -ltnp '( sport = :80 or sport = :443 )'
```

### 4.5. Kiểm tra host key trước khi lấy `known_hosts`
Từ máy cá nhân, lấy host key và fingerprint:
```bash
ssh-keyscan -t ed25519 <vps-host> > /tmp/dev-vps-hostkey.pub
ssh-keygen -lf /tmp/dev-vps-hostkey.pub
```
Đối chiếu fingerprint này với fingerprint hiển thị trong trang quản trị VPS hoặc trong console của nhà cung cấp. Chỉ khi trùng khớp mới tiếp tục lấy `known_hosts` thực dùng:
```bash
ssh-keyscan -H <vps-host>
rm -f /tmp/dev-vps-hostkey.pub
```

### 4.6. Giá trị cần đưa đi
| Giá trị | Đưa vào đâu |
| --- | --- |
| IP public hoặc DNS của VPS | `DEV_VPS_HOST` |
| `deploylp` hoặc tên user deploy thật | `DEV_VPS_USER` |
| Private key vừa tạo | `DEV_VPS_SSH_KEY` |
| Output đầy đủ của `ssh-keyscan -H <vps-host>` sau khi đã kiểm tra fingerprint | `DEV_VPS_KNOWN_HOSTS` |

Firewall cần mở inbound `22/tcp`, `80/tcp`, `443/tcp` và cho outbound tới Aiven PostgreSQL, AWS SSM, GHCR.

## 5. Lấy thông tin Prometheus đang chạy
### 5.1. Cần lấy gì
| Key trong `group_vars` | Lấy ở đâu |
| --- | --- |
| `prometheus_service_name` | `systemctl` |
| `prometheus_config_path` | unit file hoặc process args |
| `prometheus_scrape_config_path` | layout host hiện tại |
| `prometheus_file_sd_target_path` | layout host hiện tại |
| `prometheus_port` | config hoặc process args |
| `prometheus_promtool_path` | `command -v promtool` |
| `node_exporter_service_name` | `systemctl` |
| `node_exporter_config_path` | unit file hoặc distro default file |

### 5.2. Lấy trực tiếp như thế nào
```bash
systemctl list-units --type=service | grep -i prometheus
systemctl list-units --type=service | grep -i node-exporter
systemctl cat <prometheus-service-name>
systemctl cat <node-exporter-service-name>
command -v promtool
sudo ss -ltnp | grep 9090
```
Điền toàn bộ các giá trị này vào `infra/ansible/inventory/group_vars/k3s_nodes.yml`. Không đoán.

## 6. Tạo file cấu hình Ansible
### 6.1. Tạo inventory
```bash
cp infra/ansible/inventory/hosts.example.yml infra/ansible/inventory/hosts.yml
```
Điền:
```yaml
all:
  children:
    k3s_nodes:
      hosts:
        learning-platform-dev:
          ansible_host: <vps-address>
          ansible_user: <ssh-user>
```

### 6.2. Tạo group vars
```bash
cp infra/ansible/inventory/group_vars/k3s_nodes.yml.example infra/ansible/inventory/group_vars/k3s_nodes.yml
```
Phải thay hết mọi `REPLACE_WITH_*`.

### 6.3. Điền version, URL, checksum và digest
Các nhóm bắt buộc phải điền:
1. `k3s_version`, `k3s_installer_sha256`
2. `external_secrets_manifest_url`, `external_secrets_manifest_sha256`
3. `kube_state_metrics_manifest_url`, `kube_state_metrics_manifest_sha256`
4. `aws_credentials_secret_name`, `aws_region`
5. toàn bộ `ssm_parameter_keys.*`
6. `web_image`, `api_image`, `worker_image`
7. `ghcr_pull_secret_name`, `dev_public_host`, `ingress_tls_secret_name`
8. toàn bộ nhóm Prometheus và node exporter

### 6.4. Lấy manifest URL và checksum
Thực hiện riêng cho K3s installer, External Secrets Operator và kube-state-metrics.
1. Chọn release trên trang chính thức của dự án đó.
2. Sao chép đúng URL tải file manifest hoặc installer mà bạn sẽ dùng.
3. Tải file về máy local.
4. Tính SHA-256 bằng lệnh sau:
```bash
shasum -a 256 <downloaded-file>
```
5. Dán URL vào `*_manifest_url` hoặc dùng đúng giá trị release cho `k3s_version`.
6. Dán chuỗi hash 64 ký tự vào `*_sha256` hoặc `k3s_installer_sha256`.
Không dùng URL tạm, URL không rõ nguồn, hoặc hash không tự kiểm tra được.

### 6.5. Lấy image digest baseline
`web_image`, `api_image`, `worker_image` phải là immutable digest. Workflow đầu tiên không thể deploy nếu các giá trị baseline này chưa hợp lệ.
Nguồn lấy digest:
1. Từ GHCR package UI của image đang dùng.
2. Hoặc từ image đã build và push sẵn bằng `docker buildx imagetools inspect`.
Ví dụ:
```bash
docker buildx imagetools inspect ghcr.io/sirobaby/learningplatform-web:<tag>
docker buildx imagetools inspect ghcr.io/sirobaby/learningplatform-api:<tag>
```
Lấy digest `sha256:...` rồi điền:
```yaml
web_image: ghcr.io/sirobaby/learningplatform-web@sha256:<64-hex-digest>
api_image: ghcr.io/sirobaby/learningplatform-api@sha256:<64-hex-digest>
worker_image: ghcr.io/sirobaby/learningplatform-api@sha256:<64-hex-digest>
```
`api_image` và `worker_image` có thể dùng cùng một backend digest.

### 6.6. Điều gì được và không được nằm trong file này
Được có: version, checksum, exact SSM parameter paths, namespace, tên Secret Kubernetes, immutable digest, `dev_public_host`, resource requests và limits, host facts Prometheus. Không được có: AWS access key, AWS secret access key, Aiven values thật, `DB_PASSWORD`, `DB_SSL_CA`, GHCR token, `.dockerconfigjson`, SSH private key, bất kỳ runtime secret value nào.

## 7. Chuẩn bị hai Secret trong K3s
### 7.1. Điều kiện bắt buộc
Tag `k3s` phải chạy trước để tạo namespace `learning-platform-dev`. Hai Secret này không được tạo trước bước đó.

### 7.2. Secret AWS cho ESO
Tên Secret phải đúng bằng `aws_credentials_secret_name`. Hai key bắt buộc là `access-key-id` và `secret-access-key`.
```bash
AWS_SECRET_DIR="$(mktemp -d)"
chmod 700 "$AWS_SECRET_DIR"
trap 'rm -rf -- "$AWS_SECRET_DIR"' EXIT
read -r AWS_ACCESS_KEY_ID
read -r -s AWS_SECRET_ACCESS_KEY
printf '%s' "$AWS_ACCESS_KEY_ID" > "$AWS_SECRET_DIR/access-key-id"
printf '%s' "$AWS_SECRET_ACCESS_KEY" > "$AWS_SECRET_DIR/secret-access-key"
chmod 600 "$AWS_SECRET_DIR/access-key-id" "$AWS_SECRET_DIR/secret-access-key"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
kubectl -n learning-platform-dev create secret generic <aws-credentials-secret-name> \
  --from-file=access-key-id="$AWS_SECRET_DIR/access-key-id" \
  --from-file=secret-access-key="$AWS_SECRET_DIR/secret-access-key"
rm -rf -- "$AWS_SECRET_DIR"
trap - EXIT
```
Nếu chạy trực tiếp trên VPS sau bootstrap, thay `kubectl` bằng `sudo k3s kubectl`.

### 7.3. Secret GHCR pull
Tên Secret phải đúng bằng `ghcr_pull_secret_name`. Type phải là `kubernetes.io/dockerconfigjson`.
```bash
GHCR_CONFIG_DIR="$(mktemp -d)"
chmod 700 "$GHCR_CONFIG_DIR"
trap 'rm -rf -- "$GHCR_CONFIG_DIR"' EXIT
read -r GHCR_USERNAME
read -r -s GHCR_TOKEN
printf '%s' "$GHCR_TOKEN" | docker --config "$GHCR_CONFIG_DIR" login ghcr.io --username "$GHCR_USERNAME" --password-stdin
unset GHCR_USERNAME GHCR_TOKEN
kubectl -n learning-platform-dev create secret generic <ghcr-pull-secret-name> \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson="$GHCR_CONFIG_DIR/config.json"
docker --config "$GHCR_CONFIG_DIR" logout ghcr.io
rm -rf -- "$GHCR_CONFIG_DIR"
trap - EXIT
```

## 8. Khai báo GitHub Environment
### 8.1. Các key bắt buộc
| Loại | Tên | Lấy từ đâu |
| --- | --- | --- |
| Variable | `DEV_VPS_HOST` | IP public hoặc DNS của VPS |
| Variable | `DEV_VPS_USER` | user deploy trên VPS |
| Secret | `DEV_VPS_SSH_KEY` | private key SSH riêng cho user deploy |
| Secret | `DEV_VPS_KNOWN_HOSTS` | output `ssh-keyscan -H <vps-host>` sau khi đã kiểm tra fingerprint |
| Secret | `DEV_K3S_ANSIBLE_VARS_B64` | base64 của `infra/ansible/inventory/group_vars/k3s_nodes.yml` |

### 8.2. Tạo `DEV_K3S_ANSIBLE_VARS_B64`
```bash
base64 < infra/ansible/inventory/group_vars/k3s_nodes.yml | tr -d '\n'
```
Payload này chỉ được chứa non-runtime host configuration, checksums, resource limits, `dev_public_host`, tên Secret Kubernetes, `aws_region`, exact SSM parameter paths, image digest baseline. Payload này không được chứa AWS access key, AWS secret access key, Aiven values thật, DB password, nội dung `DB_SSL_CA`, GHCR pull credential hoặc bất kỳ runtime secret value nào.

### 8.3. Tạo GitHub Environment bằng giao diện web
1. Mở repository trên GitHub, vào `Settings` → `Environments` → `New environment`.
2. Nhập tên `dev`.
3. Trong environment `dev`, thêm 2 variable: `DEV_VPS_HOST`, `DEV_VPS_USER`.
4. Thêm 3 secret: `DEV_VPS_SSH_KEY`, `DEV_VPS_KNOWN_HOSTS`, `DEV_K3S_ANSIBLE_VARS_B64`.
5. Dán đúng từng giá trị vào đúng ô, lưu lại, rồi kiểm tra lại tên key không sai ký tự.

## 9. Kiểm tra trước khi chuyển sang vận hành
1. Đã thu đủ thông tin Aiven và add IP VPS vào allowlist.
2. Đã tạo đủ 18 SSM parameter đúng type.
3. Đã tạo IAM policy, IAM user và đúng một access key bootstrap.
4. Đã có user deploy riêng trên VPS, SSH key riêng, passwordless sudo và firewall phù hợp.
5. Đã kiểm tra fingerprint host key trước khi lấy `DEV_VPS_KNOWN_HOSTS`.
6. Đã thu đúng các thông tin Prometheus đang chạy trên host.
7. Đã tạo `hosts.yml` và `k3s_nodes.yml`, đã thay hết `REPLACE_WITH_*`.
8. `k3s_nodes.yml` không chứa AWS credential, Aiven values thật hoặc runtime secret.
9. `web_image`, `api_image`, `worker_image` đều là immutable digest hợp lệ.
10. Đã chuẩn bị lệnh tạo Secret AWS và Secret GHCR sau khi tag `k3s` tạo namespace.
11. GitHub Environment `dev` đã có đủ `DEV_VPS_HOST`, `DEV_VPS_USER`, `DEV_VPS_SSH_KEY`, `DEV_VPS_KNOWN_HOSTS`, `DEV_K3S_ANSIBLE_VARS_B64`.
12. GUIDE dừng ở đây. Các bước chạy và vận hành hệ thống nằm trong `docs/deployment/RUNBOOK-dev-k3s.md`.
