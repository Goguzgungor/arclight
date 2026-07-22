#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER=${CLUSTER:-arckive-dev}

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER"
docker build --target worker -t arckive-worker:dev .
kind load docker-image arckive-worker:dev --name "$CLUSTER"
kubectl apply -f charts/arckive/crds/indexer.yaml
kubectl apply -f e2e/fixtures/
kubectl rollout status deploy/postgres deploy/anvil --timeout=120s

echo "Ready. Start the operator locally:"
echo "  pnpm -r build && WORKER_IMAGE=arckive-worker:dev pnpm --filter @arckive/operator start"
