#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLUSTER=${CLUSTER:-arclight-e2e}

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER"
docker build --target worker -t arclight-worker:e2e "$ROOT"
docker build --target operator -t arclight-operator:e2e "$ROOT"
kind load docker-image arclight-worker:e2e arclight-operator:e2e --name "$CLUSTER"

helm upgrade --install arclight "$ROOT/charts/arclight" \
  --set image.tag=e2e --set workerImage.tag=e2e

kubectl apply -f "$ROOT/e2e/fixtures/"
kubectl rollout status deploy/postgres deploy/anvil deploy/arclight-operator --timeout=180s
