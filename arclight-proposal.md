# Arclight

**Arc için Kubernetes-native, self-hosted event indexer.**
Sen ABI + contract adresi + RPC ver; Arclight zincirden gelen contract event'lerini kendi PostgreSQL'ine — her event kendi tablosunda, güvenilir ve kesintisiz — yazsın. Hepsi **2-3 YAML** ile.

> Durum: Taslak öneri (v0.1) · Tarih: 2026-07-01

---

## 1. Yönetici Özeti

Web3 uygulamaları on-chain veriyi okumak zorunda, ama bugünkü yolların hepsinin ciddi bir bedeli var: **Dune** analitik için harika fakat rate-limit'li ve programatik/sürekli erişim için tasarlanmadı; **ham RPC logları (Alchemy vb.)** düşük seviyeli, decode + reorg + geri-doldurma yükünü tamamen size bırakıyor ve provider/network sorununda pipeline'ınız kör kalıyor; **The Graph** güçlü ama subgraph geliştirme ve GraphQL'e bağımlılık getiriyor. Sonuçta çoğu ekip aynı sıkıcı indexer boilerplate'ini (cursor, reorg, RPC failover, ABI decode, şema üretimi) tekrar tekrar yazıyor.

**Arclight**, bu işi bir Kubernetes Operator'e devrediyor. Küçük bir `Indexer` tanımı yazıyorsunuz (hangi contract'lar, hangi ABI, hangi RPC'ler); operatör gerisini kuruyor: veritabanı, şema, dinleyici ve opsiyonel okuma API'si. Veri **sizin** Postgres'inizde, **her event kendi tablosunda**, doğrudan SQL ile okunabilir halde duruyor.

**Neden şimdi:** Arc (Circle'ın stablecoin-odaklı, EVM-uyumlu L1'i) yeni bir ağ; olgun indexing araçları henüz oturmadı. Üstelik Arc'ın BFT (Malachite) konsensüsü **deterministik, hızlı finality** sağlıyor — bu da reorg riskini neredeyse sıfırlayıp indexer'ı Ethereum L1'e kıyasla çok daha basit ve güvenilir kılıyor. Erken davranıp kendi indexing altyapımızı kurmak hem teknik hem stratejik olarak mantıklı.

**İstenen:** v1 (MVP) geliştirmesi için onay.

---

## 2. Problem

On-chain contract event'lerini uygulama tarafında kullanılabilir veriye çevirmenin bugünkü seçenekleri:

- **Dune Analytics** — SQL ile keşif ve dashboard için mükemmel. Ama: rate-limit'li API, gecikmeli veri, veri ve şema kontrolü sizde değil, düşük-gecikmeli/programatik uygulama trafiği için tasarlanmadı.
- **Ham RPC logları (`eth_getLogs`, Alchemy/Infura)** — en esnek, en düşük seviye. Ama: dönen veri ham; **ABI decode, cursor takibi, reorg yönetimi, geri-doldurma ve failover tamamen sizde.** Provider veya network kısa süre sorun yaşarsa pipeline sessizce gap üretir. "Detaylı kullanmak zor, network patlarsa sorun oluyor" tam olarak bu.
- **The Graph** — olgun ve güçlü. Ama: subgraph geliştirmek + deploy etmek gerekir; tüketim GraphQL üzerinden (kendi Postgres'inizde ham SQL değil); kendi altyapınızda çalıştırmak (`graph-node`) ciddi operasyonel yük.
- **Kendi indexer'ını sıfırdan yazmak** — tam kontrol, ama herkes aynı boilerplate'i yeniden icat ediyor: blok cursor'u, reorg-rollback, RPC health-check/failover, ABI-→-şema, idempotent yazım, HA, gözlemlenebilirlik.

**Boşluk:** "Verim kendi Postgres'imde, doğrudan SQL ile, güvenilir ve az bakımla dursun" diyen bir ekip için temiz, declaratif bir çözüm yok — özellikle Arc gibi yeni bir ağda.

---

## 3. Neden Arc, Neden Şimdi

- **Arc = Circle'ın L1'i:** stablecoin-odaklı, **EVM-uyumlu**, USDC native gas, Malachite (Tendermint ailesi) **BFT konsensüs**. *(Ağ parametreleri — chainId, RPC uçları — dağıtım öncesi doğrulanacak.)*
- **EVM-uyumlu** olması, standart JSON-RPC (`eth_getLogs`, `finalized` blok tag'i) ve standart ABI decode'un olduğu gibi geçerli olması demek → indexer mimarisi bilinen, kanıtlanmış zeminde.
- **Deterministik finality Arc'a özel bir avantaj:** BFT konsensüste finalize olmuş blok **reorg olmaz.** Ethereum'un olasılıksal finality'sindeki derin reorg endişesi burada yok → reorg mantığı yalnızca finalize-olmamış küçük bir tip penceresine indirgeniyor → **daha basit, daha güvenilir indexer.**
- **Zamanlama:** Arc yeni; Dune tabloları, hazır subgraph'ler ve managed indexer'lar henüz olgun değil. Kendi altyapını erken kurmak, ekosistem olgunlaşırken sana bağımsızlık ve hız kazandırır.

---

## 4. Çözüm: Arclight

Arclight bir **Kubernetes Operator**. Zihinsel model basit:

> Sen bir `Indexer` kaynağı tanımlarsın (ABI'ler + contract adresleri + RPC listesi + depolama tercihi). Operatör bunu gözlemleyip **çalışan bir indexer'a** dönüştürür: veritabanı, şema/tablolar, dinleyici süreç ve (isteğe bağlı) okuma API'si.

**Merkez vaat — "2-3 YAML → tam bir indexer":** yeni birinin çalışır hale gelmesi için tek yapması gereken birkaç manifest `apply` etmek. Batteries-included, ama gerektiğinde esnek.

**Neden Operator (sadece bir script/Helm chart değil):**
- **Declaratif & GitOps-uyumlu** — istenen durumu YAML'de tanımlarsın, operatör sürekli ona yakınsar.
- **Self-healing** — reconcile döngüsü; pod ölürse, config değişirse, şema eksikse kendini toparlar.
- **Ölçeklenebilir yönetim** — onlarca indexer'ı tek kontrol düzleminden yönet.
- **K8s-native** — zaten Kubernetes + Helm + Postgres kullanan bir ekip için doğal uzantı.

---

## 5. Mimari

### Bileşenler

1. **Arclight Operator (control plane)** — `Indexer` CRD'sini izler ve reconcile eder. Go + controller-runtime (kubebuilder). Leader-election ile HA.
2. **Indexer Worker (data plane)** — "dinleyici". CR başına bir Deployment. RPC'leri dinler, log'ları decode eder, Postgres'e yazar.
3. **PostgreSQL (storage)** — event tabloları + kontrol tabloları. Üç modda çalışır (aşağıda).
4. **PostgREST (opsiyonel)** — flag açıksa şema üzerinden otomatik REST/GraphQL.

### Genel akış

```
   kubectl apply (2-3 YAML)
   ├─ ConfigMap: ABI(ler)
   ├─ Indexer (CR): rpc[], contracts[], storage modu
   └─ (Secret: DSN/cred — Service/External modda)
            │
            ▼
   ┌─────────────────────┐   reconcile   ┌───────────────────────────────┐
   │  Arclight Operator   │ ────────────▶ │  kurar / yönetir:             │
   │  (controller)        │               │   • Postgres (Embedded modda) │
   └─────────────────────┘               │   • schema + event tabloları  │
                                          │   • Indexer Worker            │
                                          │   • PostgREST (opsiyonel)     │
                                          └───────────────────────────────┘

   Arc RPC'ler ──▶ [ Indexer Worker ] ──▶ [ PostgreSQL ] ──▶ SQL / PostgREST ──▶ tüketiciler
                    failover · cursor        her event
                    reorg-safe · decode      kendi tablosunda
```

### Depolama modları (esneklik burada)

- **`Embedded`** *(varsayılan, sıfır-config)* — operatör kendi Postgres'ini (StatefulSet + PVC) kurar. Yeni başlayan biri tek `apply` ile çalışır hale gelir.
- **`Service`** — cluster içindeki mevcut bir Postgres Service'ine bağlanır (host + credentials Secret).
- **`External`** — dışarıdan bir DSN/URL alır (bir Secret'tan). Managed/harici Postgres senaryosu.

`Service`/`External` modlarında birden çok `Indexer`, ayrı şemalarla aynı Postgres'i paylaşabilir.

### CRD & Developer Experience

Happy-path — embedded DB, tek contract:

```yaml
# 1) ABI'yi ConfigMap olarak ver
apiVersion: v1
kind: ConfigMap
metadata: { name: usdc-abi }
data:
  abi.json: |
    [ {"type":"event","name":"Transfer","inputs":[ ... ]}, ... ]
---
# 2) Indexer'ı tanımla → gerisi otomatik
apiVersion: arclight.dev/v1alpha1
kind: Indexer
metadata: { name: usdc-arc }
spec:
  network:
    chainId: 0                       # <arc-chain-id> (doğrulanacak)
    rpc:                             # liste = health-check'li failover
      - https://rpc.arc.example
      - https://arc-rpc.backup.example
  storage:
    mode: Embedded                   # Embedded | Service | External
    embedded: { size: 20Gi }
  contracts:
    - name: usdc
      address: "0xA0b8...eB48"
      abi: { configMapRef: { name: usdc-abi, key: abi.json } }
      startBlock: 0
      events: [ Transfer, Approval ]  # boş bırakılırsa ABI'deki tüm event'ler
  api:
    enabled: true
    kind: PostgREST                  # opsiyonel otomatik REST/GraphQL
```

`Service`/`External` modda `storage` bloğu bunun yerine bir Secret'a işaret eder:

```yaml
  storage:
    mode: External
    external:
      dsnSecretRef: { name: pg-dsn, key: url }   # postgres://...
```

`kubectl apply` → operatör Postgres'i (gerekiyorsa), şemayı + tabloları, worker'ı ve PostgREST'i tek seferde kurar.

### Ingestion & Güvenilirlik — projenin asıl değeri

Bu katman, Arclight'ı "ham log çekmekten" ayıran şey. **Poll-tabanlı** (WebSocket değil) omurga seçtik; çünkü hedef gecikme değil, **kayıpsız ve kendini toparlayan** akış:

- **Cursor + checkpoint:** her indexer için son işlenen blok Postgres'te tutulur. Restart/çökme sonrası **kaldığı yerden** devam → gap yok.
- **Gap-free backfill:** bloklar sıralı aralıklarla (`eth_getLogs`) işlenir; cursor **ancak aralık commit olduktan sonra** ilerler. Event insert'leri + cursor güncellemesi **tek transaction**.
- **Finality/reorg (Arc avantajı):** veri `finalized` blok tag'ine kadar güvenle indekslenir; finalize blok reorg olmaz. Yalnızca finalize-olmamış küçük tip için blok-hash takibi + sapmada rollback (`block_number >= X` sil, yeniden işle).
- **RPC failover:** listeden health-check'li havuz (chainId eşleşmesi + head ilerliyor mu?); hata/timeout'ta rotasyon + backoff + circuit-breaker. **"Network patlarsa" derdinin doğrudan cevabı.**
- **Idempotent yazım:** doğal anahtar `(block_number, tx_hash, log_index)` üzerinden upsert → bir aralık yeniden işlense bile duplikasyon yok (at-least-once + idempotent = pratikte exactly-once).

### ABI → Şema (her event kendi tablosunda)

Bootstrap adımı her event için DDL üretir: şema `idx_<indexer>`, tablo `<contract>_<event>`.

- **Ortak kolonlar:** `block_number, block_hash, block_time, tx_hash, tx_index, log_index, contract_address`
- **Parametreler ABI tipine göre eşlenir:** `address → text`, `uint256/int256 → numeric(78,0)` (bigint 256-bit'i taşıramaz), `bool → boolean`, `bytes/bytesN → bytea`, `string → text`, `tuple/array → jsonb`. Indexed ve non-indexed parametrelerin ikisi de decode edilir.
- **Kısıtlar/index:** `(block_number, tx_hash, log_index)` üzerinde UNIQUE + sık filtrelenen indexed parametrelere index.
- **Şema evrimi:** ABI'ye yeni event eklenirse **additive** migration (tablo düşürülmez).
- **Kolay okuma:** yardımcı view'lar (ör. `*_latest`, decode edilmiş görünümler).

### Okuma katmanı

**SQL-first:** tablolar + view'lar; tüketici doğrudan SQL / Grafana / dbt ile okur. `api.enabled: true` ise operatör bir **PostgREST** bileşenini otomatik bağlar → sıfır kod ile REST/GraphQL. (Hasura v2'de opsiyon.)

### Gözlemlenebilirlik & Güvenlik (özet)

- **Metrics (Prometheus):** `blocks_behind` (lag), `events_ingested_total`, `rpc_errors_total`, `reorgs_total`, yazım gecikmesi.
- **CR `.status`:** currentBlock / headBlock / lag / phase (`Provisioning`→`Backfilling`→`Live`→`Degraded`) / son hata.
- **Güvenlik:** RPC uçları ve DB kimlik bilgileri Secret'ta; indexer başına en az yetkili DB rolü; embedded modda credential otomatik üretilip Secret'a yazılır.

---

## 6. Alternatiflerle Kıyas

| | Dune | Alchemy (ham log) | The Graph | Ponder | **Arclight** |
|---|---|---|---|---|---|
| Veri kendi DB'nde | Hayır | Kurarsan | `graph-node` ile | Evet | **Evet** |
| Doğrudan SQL erişimi | Evet (Dune SQL) | Hayır (ham JSON) | Hayır (GraphQL) | Evet | **Evet** |
| Self-hosted (veri sende) | Hayır | Kısmi | Opsiyonel (ağır) | Evet | **Evet** |
| Rate-limit derdi | Var | Var | Hosted'da var | RPC'ne bağlı | **RPC'ne bağlı (+failover)** |
| Reorg/gap dayanıklılığı | Onlarda | **Sizde** | Var | Var | **Var (built-in)** |
| Kod yazmadan (declaratif) | SQL yazarsın | Uygulama yazarsın | Subgraph yazarsın | TS yazarsın | **Evet (YAML)** |
| K8s-native yaşam döngüsü | – | – | Manuel | Manuel | **Evet (operator)** |
| Kurulum eforu | Düşük | Yüksek | Orta-Yüksek | Orta | **Düşük (2-3 YAML)** |

**Dürüst konumlandırma:** Ad-hoc analitik ve dashboard için **Dune** hâlâ doğru araç; çok-zincirli hosted ihtiyaç için **The Graph** güçlü. Arclight'ın kazandığı yer şu özgün birleşim: *kendi Postgres'in + doğrudan SQL + self-hosted + kod yazmadan + Kubernetes-native yaşam döngüsü + düşük kurulum.* En yakın komşu **Ponder**'dır; farkımız Ponder'ın bir **geliştirici framework'ü** (TS handler yazıp uygulamayı kendin deploy edersin) olması, Arclight'ın ise **declaratif, platform-yönetimli bir operatör** olmasıdır.

---

## 7. Kapsam & Yol Haritası

**v1 (MVP):** tek `Indexer` CRD'si; üç DB modu; poll-tabanlı gap-free ingestion (`finalized`'a kadar); ABI→şema DDL; idempotent yazım; cursor/resume; RPC failover; metrics + `.status`; SQL view'lar.

**v1.1:** opsiyonel PostgREST; finalize-olmamış tip için reorg-rollback; düşük-gecikme için opsiyonel WebSocket tip takibi.

**v2:** Hasura/GraphQL; paylaşımlı-DB multi-tenant optimizasyonları; backfill paralelizmi; ABI-değişim migration UX'i; CloudNativePG'yi opsiyonel embedded backend olarak devralma.

**Non-goals (v1):** analitik dashboard/BI aracı değil; genel-amaçlı çok-zincirli hosted servis değil (EVM-generic ama Arc'a odaklı); zincir-üstü yazma/işlem gönderme yok.

---

## 8. Riskler & Açık Sorular

- **RPC bağımlılığı** — sağlam RPC uçlarına ihtiyaç var; failover havuzu ile azaltılıyor ama tek-nokta-arıza riskini RPC çeşitliliğiyle yönetmek gerek.
- **Embedded Postgres'in stateful yükü** — backup/upgrade/HA sorumluluğu; v1'de basit StatefulSet, üretimde `External`/`Service` mod veya v2'de CloudNativePG önerilir.
- **Arc RPC olgunluğu** — `finalized` tag'i ve `eth_getLogs` davranışı doğrulanmalı; ağ parametreleri (chainId, uçlar) teyit edilecek.
- **ABI değişimi/migration** — additive strateji seçildi; breaking değişimler için operasyonel akış tanımlanmalı.
- **Yüksek-hacimli event'ler** — çok yüksek throughput'ta batch/COPY, partition ve index stratejisi gerekebilir (v2 backfill paralelizmi).

---

## 9. Sonuç & Öneri

Arc üzerinde on-chain veriye güvenilir, sahipliği bizde olan erişim, bugünkü araçlarla ya kırılgan (ham log) ya kısıtlı (Dune) ya da ağır (kendin yaz / The Graph çalıştır). **Arclight**, bu ihtiyacı Kubernetes-native, declaratif bir operatörle karşılıyor: *2-3 YAML → kendi Postgres'inde, her event kendi tablosunda, kesintisiz akan bir indexer.* Arc'ın deterministik finality'si tasarımı hem basitleştiriyor hem güvenilirleştiriyor, ve ağın erken evresi bunu kurmak için doğru zaman.

**Öneri:** Bölüm 7'deki v1 (MVP) kapsamını hayata geçirmek için ilerleyelim.

---

*İsim notu: "Arclight" — hem Arc ağına gönderme, hem de "zincirde olan biteni aydınlatan ışık" metaforu. Alternatifler: Aqueduct, Sluice.*
