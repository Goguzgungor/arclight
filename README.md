# Arclight

Arc (Circle'ın stablecoin-odaklı EVM L1'i) için Kubernetes-native, self-hosted
contract-event indexer. Bir `Indexer` custom resource'u tanımlarsın; operatör
worker'ı kurar, worker şema/tabloları bootstrap edip event'leri **kendi
Postgres'ine** yazar — her event kendi tablosunda, doğrudan SQL ile okunur.

```
kubectl apply (ConfigMap[ABI] + Indexer CR + Secret[DSN])
        │ watch/reconcile
        ▼
[ Operator ] ──kurar──▶ worker Deployment + config ConfigMap
                              │
Arc RPC'ler ──WS newHeads + poll fallback──▶ [ Worker ] ──tek tx──▶ [ Postgres ]
                                            └──status patch──▶ Indexer .status
```

## Quickstart (3 YAML)

Önkoşul: çalışan bir Kubernetes cluster'ı ve erişilebilir bir Postgres.

```bash
# 1) Operatörü kur (CRD dahil)
helm install arclight charts/arclight \
  --set image.repository=<registry>/arclight-operator --set image.tag=<tag> \
  --set workerImage.repository=<registry>/arclight-worker --set workerImage.tag=<tag>

# 2) DSN Secret + ABI ConfigMap + Indexer CR
kubectl create secret generic pg-dsn --from-literal=url='postgres://user:pass@host:5432/db'
kubectl create configmap usdc-abi --from-file=abi.json=manifests/arc-testnet/usdc-abi.json
kubectl apply -f manifests/arc-testnet/k8s/indexer.yaml

# 3) İzle
kubectl get indexers
# NAME       PHASE   CURRENT   HEAD      LAG
# usdc-arc   Live    8123456   8123456   0
```

`rpc` listesine bir `wss://` ucu eklersen worker yeni bloğu `eth_subscribe(newHeads)`
ile anında görür; yoksa `polling.intervalMs` aralığıyla poll eder (WS varken de
güvenlik ağı olarak çalışır).

Veri: `idx_<indexer>` şemasında `<contract>_<event>` tabloları
(`idx_usdc_arc.usdc_transfer` gibi) + `_cursor`, `_meta`, `_dead_letter`
kontrol tabloları. CR silinince worker kaynakları temizlenir, **DB'ye
dokunulmaz**.

## Gözlemlenebilirlik

Worker `:9090/metrics` (Prometheus) ve `:9090/healthz` sunar:
`arclight_blocks_behind`, `arclight_events_ingested_total`,
`arclight_rpc_errors_total`, `arclight_last_processed_block`,
`arclight_dead_letter_total`, `arclight_write_latency_seconds`,
`arclight_ws_connected`, `arclight_head_notifications_total`.

## Geliştirme

```bash
pnpm install
pnpm -r build && pnpm -r test        # birim + entegrasyon (Docker + Foundry gerekir)
docker compose -f docker-compose.dev.yml up   # operatörsüz lokal demo (anvil + pg)
pnpm demo:seed                                # demo kontratı deploy + 10 event
./scripts/kind-dev.sh                         # kind geliştirme ortamı
pnpm e2e                                      # kind uçtan uca test (kind + helm gerekir)
```

Not: Helm, CRD'yi yalnızca ilk kurulumda (`crds/` klasöründen) uygular;
CRD güncellemeleri `kubectl apply -f charts/arclight/crds/indexer.yaml` ile
elle yapılır.

Tasarım: `docs/superpowers/specs/2026-07-03-arclight-mvp-design.md` ·
Arc testnet doğrulaması: `docs/arc-testnet-validation.md`
