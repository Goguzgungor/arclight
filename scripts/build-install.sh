#!/usr/bin/env bash
# Tek dosyalık kurulum manifesti üretir: Namespace + CRD + operatör (helm template).
# Çıktı https://arckive.org/install.yaml olarak yayınlanır; elle düzenlenmez.
#
# Kullanım: scripts/build-install.sh
#   REGISTRY=ghcr.io/goguzgungor TAG=latest OUT=install.yaml (varsayılanlar)
set -euo pipefail

REGISTRY="${REGISTRY:-ghcr.io/goguzgungor}"
TAG="${TAG:-latest}"
OUT="${OUT:-install.yaml}"

cd "$(dirname "$0")/.."

{
  echo "# Arckive (arclight) kurulumu — scripts/build-install.sh üretir, elle düzenlemeyin."
  echo "# kubectl apply -f https://arckive.org/install.yaml"
  echo "---"
  cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: arclight-system
  labels:
    app.kubernetes.io/name: arclight-operator
EOF
  for crd in charts/arclight/crds/*.yaml; do
    echo "---"
    cat "$crd"
  done
  helm template arclight charts/arclight \
    --namespace arclight-system \
    --set image.repository="${REGISTRY}/arclight-operator" \
    --set image.tag="${TAG}" \
    --set image.pullPolicy=Always \
    --set workerImage.repository="${REGISTRY}/arclight-worker" \
    --set workerImage.tag="${TAG}"
} > "$OUT"

echo "yazıldı: ${OUT} (registry=${REGISTRY} tag=${TAG})"
