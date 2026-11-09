#!/bin/bash
# Deploy the already-loaded image tag opendot:<sha> as opendot:local.
# Only the Compose project in /opt/opendot is touched. Other containers stay up.
set -euo pipefail

SHA="${1:-}"
KEEP="${2:-5}"
COMPOSE_DIR=/opt/opendot
HEALTH_URL=http://127.0.0.1:3300/api/health

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "需要 40 位 commit SHA，收到: ${SHA:-空}"
  exit 1
fi

cd "$COMPOSE_DIR"

# docker load may already have moved opendot:local to the new image.
# The existing container still identifies the last deployed image exactly.
previous_image="$(sudo docker inspect opendot --format '{{.Image}}' 2>/dev/null || true)"
if [[ -n "$previous_image" ]] && sudo docker image inspect "$previous_image" >/dev/null 2>&1; then
  sudo docker tag "$previous_image" opendot:rollback
  echo "已把运行容器的镜像标为 opendot:rollback"
else
  echo "没有已有容器可用于回滚"
fi

if ! sudo docker image inspect "opendot:${SHA}" >/dev/null 2>&1; then
  echo "服务器上没有镜像 opendot:${SHA}"
  exit 1
fi

rollback() {
  echo "准备回滚到 opendot:rollback"
  sudo docker logs opendot --tail 80 || true
  if sudo docker image inspect opendot:rollback >/dev/null 2>&1; then
    sudo docker tag opendot:rollback opendot:local
    sudo docker compose -p opendot up -d --no-build --remove-orphans || true
    sleep 3
    echo "回滚后的健康检查:"
    curl -fsS --max-time 5 "$HEALTH_URL" || echo "回滚后的实例也没有通过健康检查"
  else
    echo "没有 opendot:rollback，无法回滚"
  fi
}

sudo docker tag "opendot:${SHA}" opendot:local
echo "启动 opendot:${SHA}"
if ! sudo docker compose -p opendot up -d --no-build --remove-orphans; then
  rollback
  exit 1
fi

healthy=0
for _ in $(seq 1 30); do
  body="$(curl -fsS --max-time 5 "$HEALTH_URL" || true)"
  if [[ "$body" == *'"ok":true'* && "$body" == *'"app":"opendot"'* ]]; then
    echo "健康检查通过: $body"
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" != 1 ]]; then
  echo "健康检查失败"
  rollback
  exit 1
fi

running="$(sudo docker inspect opendot --format '{{.Image}}')"
local_id="$(sudo docker image inspect opendot:local --format '{{.Id}}')"
rollback_id=""
if sudo docker image inspect opendot:rollback >/dev/null 2>&1; then
  rollback_id="$(sudo docker image inspect opendot:rollback --format '{{.Id}}')"
fi

mapfile -t old_tags < <(
  while read -r tag; do
    [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || continue
    created="$(sudo docker image inspect "opendot:${tag}" --format '{{.Created}}')"
    printf '%s %s\n' "$created" "$tag"
  done < <(sudo docker images opendot --format '{{.Tag}}') | sort -r | awk -v keep="$KEEP" 'NR > keep { print $2 }'
)

for tag in "${old_tags[@]+"${old_tags[@]}"}"; do
  id="$(sudo docker image inspect "opendot:${tag}" --format '{{.Id}}' || true)"
  if [[ -z "$id" || "$id" == "$running" || "$id" == "$local_id" || "$id" == "$rollback_id" ]]; then
    echo "保留 opendot:${tag}"
    continue
  fi
  echo "删除旧标签 opendot:${tag}"
  sudo docker rmi "opendot:${tag}" || echo "跳过仍被占用的 opendot:${tag}"
done
