# Arckive

Kubernetes-native, self-hosted contract-event indexer for Arc (Circle's
stablecoin-focused EVM L1). You declare an `Indexer` custom resource; the
operator provisions a worker, the worker bootstraps the schema/tables and
streams events into **your own Postgres** — one table per event, readable
with plain SQL.

```
kubectl apply (ConfigMap[ABI] + Indexer CR + Secret[DSN])
        │ watch/reconcile
        ▼
[ Operator ] ──provisions──▶ worker Deployment + config ConfigMap
                              │
Arc RPCs ──WS newHeads + poll fallback──▶ [ Worker ] ──single tx──▶ [ Postgres ]
                                          └──status patch──▶ Indexer .status
```

## Quickstart (3 YAMLs)

Prerequisites: a running Kubernetes cluster and a reachable Postgres.

```bash
# 1) Install the operator (CRD included)
kubectl apply -f https://arckive.org/install.yaml

# 2) DSN Secret + ABI ConfigMap + Indexer CR
kubectl create secret generic pg-dsn --from-literal=url='postgres://user:pass@host:5432/db'
kubectl create configmap usdc-abi --from-file=abi.json=manifests/arc-testnet/usdc-abi.json
kubectl apply -f manifests/arc-testnet/k8s/indexer.yaml

# 3) Watch
kubectl get indexers
# NAME       PHASE   CURRENT   HEAD      LAG
# usdc-arc   Live    8123456   8123456   0
```

`install.yaml` is generated from the chart by `scripts/build-install.sh`
(Namespace + CRD + operator; images
`ghcr.io/goguzgungor/arckive-{operator,worker}:latest`) and published to a
GitHub Release on every push to `main`. The Helm path still works if you want
your own images: `helm install arckive charts/arckive
--set image.repository=... --set workerImage.repository=...`

Add a `wss://` endpoint to the `rpc` list and the worker sees each new block
instantly via `eth_subscribe(newHeads)`; otherwise it polls every
`polling.intervalMs` (which stays on as a safety net even with WS). Endpoints
that announce fast but rate-limit queries can go into `announceRpc` — they are
listened to only and never queried.

Data: `<contract>_<event>` tables in an `idx_<indexer>` schema
(e.g. `idx_usdc_arc.usdc_transfer`) plus `_cursor`, `_meta`, `_dead_letter`
control tables. Deleting the CR cleans up the worker resources and **never
touches the DB**.

## Benchmarks

Every number comes from running the real worker and reading only its
production surface (Postgres rows + `/metrics`) — no benchmark
instrumentation in product code:

| Measurement | Result | Context |
|---|---|---|
| Block → SQL, p50 | **395ms** (p99 0.97s) | Arc public testnet USDC, WS `newHeads` listening; official endpoint in `announceRpc`, queries on drpc |
| Backfill | **92.6 blocks/s** | 5,107 blocks of real USDC history in 55s — ~48× faster than the chain, zero RPC errors |
| Burst ingest | **2,628 events/s** | Local anvil; decode + single-transaction SQL write ceiling |
| Provider floor | ~0.75–0.9s (p50) | The official endpoint's `newHeads` announce lag — the part of the budget outside the indexer (the engine itself adds ~40ms) |

Freshness is read from the product's own meta columns
(`_ingested_at − block_time`); a run is invalidated if the WS connection does
not stay up for the whole window. When Arc mainnet launches, the same suite
runs there with a single `NETWORKS` entry. Raw results and the HTML report
live in `docs/benchmarks/` · reproduce with `pnpm bench`
(prerequisite: `docker compose -f docker-compose.dev.yml up -d postgres anvil`).

## Observability

The worker serves `:9090/metrics` (Prometheus) and `:9090/healthz`:
`arckive_blocks_behind`, `arckive_events_ingested_total`,
`arckive_rpc_errors_total`, `arckive_last_processed_block`,
`arckive_dead_letter_total`, `arckive_write_latency_seconds`,
`arckive_ws_connected`, `arckive_head_notifications_total`.

## Development

```bash
pnpm install
pnpm -r build && pnpm -r test        # unit + integration (needs Docker + Foundry)
docker compose -f docker-compose.dev.yml up   # operator-less local demo (anvil + pg)
pnpm demo:seed                                # deploy the demo contract + 10 events
./scripts/kind-dev.sh                         # kind development environment
pnpm e2e                                      # end-to-end on kind (needs kind + helm)
```

Note: Helm applies the CRD only on first install (from `crds/`); CRD updates
are applied manually with `kubectl apply -f charts/arckive/crds/indexer.yaml`.
