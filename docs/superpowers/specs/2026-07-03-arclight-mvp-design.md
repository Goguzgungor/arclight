# Arclight MVP — Tasarım Dokümanı

> Durum: Onaylanmış tasarım · Tarih: 2026-07-03
> Kaynak: `arclight-proposal.md` (v0.1) üzerine, TypeScript stack kararıyla güncellenmiş MVP kapsamı.

## 1. Amaç ve Kapsam

Arclight, Arc (Circle'ın stablecoin-odaklı, EVM-uyumlu L1'i) için Kubernetes-native, self-hosted bir contract-event indexer'ıdır. Kullanıcı bir `Indexer` custom resource'u tanımlar (ABI + contract adresleri + RPC listesi + DSN); operatör çalışan bir indexer kurar: şema, tablolar, dinleyici worker. Veri kullanıcının kendi Postgres'inde, her event kendi tablosunda, doğrudan SQL ile okunur.

### MVP kapsamı (onaylanan kararlar)

| Karar | Seçim | Gerekçe |
|---|---|---|
| Dil/stack | **Full TypeScript** (operatör + worker) | Circle ekosistemi (tüm @circle-fin SDK'ları, Arc araçları) TS/Node; tek dil, tek toolchain. |
| Circle uyumu | Dil/ekosistem düzeyinde | MVP'de Circle SDK'sı doğrudan kullanılmaz; TS/Node stack ileride sorunsuz entegrasyon sağlar. |
| Test hedefi | **Arc testnet doğrudan** | Geliştirme lokal (anvil), doğrulama gerçek ağda. |
| Depolama modu | **Sadece `External`** (DSN Secret) | Embedded/Service v1.1+'a ertelendi; MVP mevcut Postgres'e bağlanır. |
| Reorg yönetimi | **Yok** (yalnızca `finalized`'a kadar indeksleme) | Arc'ın BFT (Malachite) deterministik finality'sinde finalize blok reorg olmaz; MVP tip penceresini hiç izlemez. |
| Operatör HA | Tek replika (Recreate) | Leader-election v1.1. |
| PostgREST | Yok | Öneride zaten v1.1. |

### Non-goals (MVP)

- Analitik/BI aracı değil; çok-zincirli hosted servis değil; zincire yazma yok.
- Embedded/Service depolama modları, PostgREST, WebSocket tip takibi, reorg-rollback, leader-election, backfill paralelizmi: MVP dışı (bkz. §9 yol haritası).

## 2. Doğrulanmış Ağ Parametreleri (Arc Testnet)

- **chainId:** 5042002 (`0x4cef52`)
- **Gas token:** USDC
- **Explorer:** https://testnet.arcscan.app/
- **RPC sağlayıcıları:** dRPC (`https://arc-testnet.drpc.org`), Alchemy, QuickNode, GetBlock; ayrıca `circlefin/arc-node` ile self-host mümkün.
- `finalized` blok tag'i ve `eth_getLogs` davranışı M5'te (Arc doğrulama milestone'u) gerçek ağda teyit edilir; uyuşmazlık çıkarsa cursor stratejisi gözden geçirilir.

## 3. Stack

| Katman | Seçim | Not |
|---|---|---|
| Runtime | Node 22 LTS, TypeScript 5.x, ESM | |
| Monorepo | pnpm workspaces | Paketler: `core`, `operator`, `worker` |
| K8s client/framework | **kubernetes-fluent-client** (KFC) | Aktif bakımlı (son yayın Temmuz 2026); watch + auto-reconnect + server-side apply. `@dot-i/k8s-operator` bayat (Mart 2025) olduğu için elendi. |
| EVM | **viem** | `finalized` tag, `getLogs`, `decodeEventLog`, `fallback` transport (failover) native. |
| DB | `pg` + raw SQL | ABI→DDL dinamik üretim ORM'e uymaz; kontrol tabloları elle migration. |
| Validasyon | zod | CRD spec + worker config. |
| Test | vitest, testcontainers (Postgres), anvil (Foundry), kind | |
| Ops | pino (log), prom-client (metrics), Docker multi-stage, Helm chart | |

## 4. Mimari

### Monorepo düzeni

```
arclight/
├── packages/
│   ├── core/        # paylaşılan: CRD tipleri (zod), ABI→DDL, event decode, config şemaları
│   ├── operator/    # KFC tabanlı reconcile control-plane
│   └── worker/      # indexer data plane (viem + pg)
├── charts/arclight/ # Helm: CRD + RBAC + operatör Deployment
├── manifests/       # örnek Indexer CR'ları (demo: Arc testnet USDC)
├── e2e/             # kind tabanlı uçtan uca testler
└── docs/
```

Her paketin tek sorumluluğu var; `core` saf fonksiyonlardan oluşur (I/O yok) ve iki taraf da onu tüketir. Operatör worker'ı yalnızca Deployment olarak tanır; worker operatörü hiç tanımaz — iletişim yalnızca CR spec/status ve ConfigMap üzerinden.

### Bileşen akışı

```
kubectl apply (2-3 YAML: ConfigMap[ABI] + Indexer CR + Secret[DSN])
        │ watch/reconcile
        ▼
[ Operator ] ──kurar──▶ worker Deployment + config ConfigMap
                              │
Arc RPC'ler ──finalized'a kadar poll──▶ [ Worker ] ──tek tx──▶ [ Postgres (External) ]
                                            │                        her event kendi tablosunda
                                            └──status patch──▶ Indexer CR .status
```

## 5. CRD ve Operatör

### `Indexer` CRD (arclight.dev/v1alpha1) — MVP spec

```yaml
apiVersion: arclight.dev/v1alpha1
kind: Indexer
metadata: { name: usdc-arc }
spec:
  network:
    chainId: 5042002
    rpc:
      - https://arc-testnet.drpc.org
      - https://<yedek-rpc>
  storage:
    mode: External               # MVP'de tek mod
    external:
      dsnSecretRef: { name: pg-dsn, key: url }
  contracts:
    - name: usdc
      address: "0x..."
      abi: { configMapRef: { name: usdc-abi, key: abi.json } }
      startBlock: 0
      events: [ Transfer, Approval ]   # boş = ABI'deki tüm event'ler
  polling:
    batchBlocks: 1000            # opsiyonel, varsayılanlar makul
    intervalMs: 2000
```

### Reconcile davranışı

- **Watch + resync:** KFC watch (otomatik reconnect) + ~5 dk periyodik resync; level-triggered — her reconcile istenen durumu baştan hesaplar.
- **Adımlar:** spec'i zod ile doğrula → ABI ConfigMap + DSN Secret varlığını kontrol et → worker config'ini render edip ConfigMap olarak yaz → worker Deployment'ı kur/güncelle (config hash annotation ile değişimde rollout) → `.status` güncelle.
- **Finalizer:** CR silinince worker Deployment + config ConfigMap silinir; **DB şema/tablolara dokunulmaz** (veri güvenliği).
- **Status iki yazarlı (SSA field manager ayrımı):** operatör provizyon durumu ve koşulları yazar; worker kendi CR'ının `currentBlock / headBlock / lag / phase` alanlarını patch'ler. Faz akışı: `Provisioning → Backfilling → Live → Degraded`.
- **RBAC:** operatör — Indexer CR'ları (tüm ns veya scoped), Deployments, ConfigMaps, Secret read; worker — yalnızca kendi CR'ının status subresource'u.
- Printer kolonları: `kubectl get indexers` → `PHASE / CURRENT / HEAD / LAG`.

## 6. Worker: Ingestion Hattı

### Açılış (bootstrap)

1. Config oku (ConfigMap'ten dosya + env), zod ile doğrula.
2. Postgres'e bağlan; `idx_<indexer>` şeması + kontrol tabloları (`_cursor`, `_meta`, `_dead_letter`) idempotent kurulur.
3. ABI'den event tablo DDL'leri üret, `CREATE TABLE IF NOT EXISTS` ile uygula; mevcut tablo ile ABI imzası uyuşmazsa **açık hatayla `Degraded`** (sessiz bozulma yok).
4. RPC havuzunda **chainId doğrula**; uyuşmayan uç havuzdan düşer, hiçbiri kalmazsa `Degraded`.

### Ana döngü

1. `finalized` blok numarasını al.
2. `cursor < finalized` ise: `[cursor+1, min(cursor+batchBlocks, finalized)]` aralığı için contract adres kümesiyle `eth_getLogs` → viem `decodeEventLog`.
3. **Tek transaction:** event insert'leri (`INSERT ... ON CONFLICT (block_number, tx_hash, log_index) DO NOTHING`) + cursor güncellemesi → commit. Cursor ancak aralık commit olunca ilerler → gap imkânsız.
4. Yakalanınca `intervalMs` (vars. 2 sn) poll — Arc sub-second finality ile canlıya yakın kalır.
5. Çökme/restart → cursor'dan devam. At-least-once + idempotent yazım ≈ exactly-once.

### Güvenilirlik

- **RPC failover:** viem `fallback([http(rpc1), http(rpc2), ...])` — sağlık sıralaması, otomatik rotasyon, backoff. Elle circuit-breaker yazılmaz.
- **Dead-letter:** decode edilemeyen log ham haliyle `_dead_letter` tablosuna + metrik; pipeline durmaz, veri kaybolmaz.
- **Geçici RPC/DB hatası:** üstel backoff ile yeniden dene; eşik aşılırsa faz `Degraded` + son hata `.status`a yazılır; toparlanınca otomatik `Live`.

## 7. ABI → Şema

- Şema: `idx_<indexer>`; tablo: `<contract>_<event>` (snake_case).
- **Ortak kolonlar:** `block_number bigint, block_hash text, block_time timestamptz, tx_hash text, tx_index int, log_index int, contract_address text`.
- **Tip eşleme:** `address→text` (lowercase) · `uintN/intN→numeric(78,0)` · `bool→boolean` · `bytes/bytesN→bytea` · `string→text` · `tuple/array→jsonb`. Indexed + non-indexed parametrelerin ikisi de decode edilir.
- **Kısıtlar:** `UNIQUE (block_number, tx_hash, log_index)`; indexed parametrelere B-tree index.
- **Overload edilmiş event'ler:** isim çakışmasında tablo adına topic0'ın ilk 4 hex'i eklenir.
- **Şema evrimi (MVP):** yalnızca additive — yeni event = yeni tablo. Mevcut event imza değişikliği → açık hata + `Degraded`; migration UX v2.

## 8. Gözlemlenebilirlik ve Test

### Metrikler ve sağlık

- Worker `/metrics` (prom-client): `arclight_blocks_behind`, `arclight_events_ingested_total`, `arclight_rpc_errors_total`, `arclight_last_processed_block`, yazım gecikmesi histogramı, `arclight_dead_letter_total`.
- `/healthz`: liveness/readiness. Log: pino, yapılandırılmış JSON, indexer adı etiketli.

### Test piramidi

1. **Birim (vitest, `core`):** ABI→DDL, tip eşleme, decode, aralık planlayıcı, zod doğrulama.
2. **Entegrasyon:** testcontainers-Postgres (idempotent yazım, tek-tx cursor) + anvil (test contract deploy → event üret → indekslendiğini doğrula → worker kill-restart → gap yok).
3. **E2E (kind):** Helm install → örnek CR → tabloda satır bekle; CR silme → Deployment temizlenir, tablolar kalır.
4. **Arc testnet doğrulaması (M5):** gerçek USDC contract'ı; `finalized` tag, chainId, event akışı gerçek ağda teyit.

## 9. Yol Haritası

### MVP milestone'ları (her biri çalışır/test edilir durumda biter)

| # | Milestone | İçerik | Bitti demek |
|---|---|---|---|
| M0 | İskelet | pnpm monorepo, TS/ESLint/CI, paket sınırları | CI yeşil |
| M1 | Core | ABI→DDL, decode, zod CRD tipleri | Birim testler geçer |
| M2 | Worker | Ingestion döngüsü, cursor, failover, metrics, dead-letter | anvil+testcontainers entegrasyonu geçer; kill-restart'ta gap yok |
| M3 | Operatör | CRD, KFC reconcile, worker Deployment yaşam döngüsü, status, finalizer | Lokal cluster'da CR → çalışan worker |
| M4 | Paketleme | Helm chart, örnek manifest'ler, README/quickstart | kind e2e geçer; "2-3 YAML → indexer" demosu çalışır |
| M5 | Arc doğrulama | Testnet USDC indeksleme, ağ parametre teyidi | Arc testnet'te canlı, `Live` fazında, lag ~0 |

Sıra bilinçli: worker (asıl değer) operatörden önce — M2 sonunda operatörsüz bile (docker ile) çalışan, test edilebilir bir indexer vardır.

### MVP sonrası

- **v1.1:** Embedded + Service depolama modları · PostgREST · operatör leader-election · WebSocket düşük-gecikme tip takibi.
- **v2:** Hasura/GraphQL · multi-tenant DB optimizasyonları · backfill paralelizmi · ABI-migration UX · CloudNativePG embedded backend.

## 10. Riskler

- **Arc RPC olgunluğu:** `finalized` tag/`eth_getLogs` davranışı M5'te doğrulanacak; sapma çıkarsa cursor stratejisi güncellenir. (Erken doğrulama istenirse M2 entegrasyon testleri Arc testnet'e karşı da koşulabilir.)
- **KFC bağımlılığı:** aktif bakımlı ama @kubernetes/client-node'a kıyasla küçük topluluk; KFC yalnızca watch/apply sarmalayıcısı olarak kullanılır, reconcile mantığı bizde — gerekirse alt katmana inmek lokal bir değişiklik.
- **Yüksek hacimli event'ler:** MVP `INSERT ... ON CONFLICT` batch'leriyle yetinir; çok yüksek throughput'ta COPY/partition v2 konusu.
- **Tek worker replikası:** CR başına tek pod; yatay ölçekleme (blok aralığı sharding) MVP dışı.
