#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER=${CLUSTER:-arclight-dev}

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER"
docker build --target worker -t arclight-worker:dev .
kind load docker-image arclight-worker:dev --name "$CLUSTER"
kubectl apply -f charts/arclight/crds/indexer.yaml
kubectl apply -f e2e/fixtures/
kubectl rollout status deploy/postgres deploy/anvil --timeout=120s

echo "Ready. Start the operator locally:"
echo "  pnpm -r build && WORKER_IMAGE=arclight-worker:dev pnpm --filter @arclight/operator start"
