#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLUSTER=${CLUSTER:-arckive-e2e}

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER"
docker build --target worker -t arckive-worker:e2e "$ROOT"
docker build --target operator -t arckive-operator:e2e "$ROOT"
kind load docker-image arckive-worker:e2e arckive-operator:e2e --name "$CLUSTER"

helm upgrade --install arckive "$ROOT/charts/arckive" \
  --set image.tag=e2e --set workerImage.tag=e2e

kubectl apply -f "$ROOT/e2e/fixtures/"
kubectl rollout status deploy/postgres deploy/anvil deploy/arckive-operator --timeout=180s
