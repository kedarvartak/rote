#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  umask 077
  random_secret() {
    node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))'
  }
  cat > .env <<EOF
ROTE_CURVE_DB_PASSWORD=$(random_secret)
ROTE_CURVE_DB_ROOT_PASSWORD=$(random_secret)
ROTE_CURVE_WP_ADMIN_USER=rote-admin
ROTE_CURVE_WP_ADMIN_PASSWORD=$(random_secret)
EOF
fi
set -a
# Docker Compose and the setup command share one generated local credential set.
source .env
set +a

if [[ "${1:-}" == "--reset" ]]; then
  docker compose down --volumes --remove-orphans
fi

docker compose up --detach db wordpress

for attempt in $(seq 1 60); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:18081/wp-admin/install.php; then
    break
  fi
  if [[ "$attempt" == 60 ]]; then
    echo "WordPress did not become ready within 120 seconds" >&2
    docker compose logs wordpress >&2
    exit 1
  fi
  sleep 2
done

if ! docker compose run --rm cli wp core is-installed >/dev/null 2>&1; then
  docker compose run --rm cli wp core install \
    --url=http://127.0.0.1:18081 \
    --title='Rote Curve Portal' \
    --admin_user="$ROTE_CURVE_WP_ADMIN_USER" \
    --admin_password="$ROTE_CURVE_WP_ADMIN_PASSWORD" \
    --admin_email=rote@example.test \
    --skip-email
fi

docker compose run --rm -T cli wp eval-file /seed.php

echo 'WordPress curve portal ready:'
echo '  URL:      http://127.0.0.1:18081/wp-admin/edit.php'
echo "  Username: $ROTE_CURVE_WP_ADMIN_USER"
echo '  Password: generated in scripts/bench/curve/wordpress/.env'
