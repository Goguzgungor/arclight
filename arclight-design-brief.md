# Arclight — Sunum Tasarım Brief'i

> **Tasarım aracına talimat:** Aşağıdaki içerikten **Arclight** için profesyonel bir **pitch sunumu (~12 slayt)** tasarla. Bu bir teknik altyapı / web3 developer-tool projesidir. Slayt sırası, her slaytın başlığı, ana mesajı, kısa madde metinleri ve görsel önerisi aşağıda verilmiştir. Metinler slayta hazır ve kısadır — uzun paragraf ekleme. Hedef format: slayt destesi (HTML/interaktif deck veya slide olabilir); aynı bölümler tek-sayfa landing / one-pager olarak da kullanılabilir.

---

## Bağlam (proje özeti)

- **Ne:** Arc ağı için Kubernetes-native, self-hosted contract-event indexer'ı (bir Kubernetes Operator).
- **Tek cümle:** *ABI + contract adresi + RPC ver; Arclight zincir event'lerini kendi PostgreSQL'ine — her event kendi tablosunda, kesintisiz — yazsın. 2-3 YAML ile.*
- **Kitle:** Karma — teknik ekip + liderlik. Yönetici özeti anlaşılır, teknik slaytlar derin olmalı.
- **Amaç:** Projeyi ve *neden mantıklı olduğunu* anlatan ikna edici ama dürüst bir pitch.

---

## Tasarım yönü (öneri — tasarımcı gerekirse değiştirebilir)

- **His:** Modern, teknik-güvenilir, developer-tool / infra estetiği (Linear / Vercel / Grafana çağrışımı). Bol negatif alan, güçlü ızgara hizası.
- **Renk:** Koyu-mod dostu; nötr grafit zemin + **tek canlı accent** (Arc'a ve "arc light" ışık metaforuna uygun elektrik mavisi / camgöbeği). Accent'i vurgular, veri ve CTA'larda kullan.
- **Tipografi:** Net, iri bold sans-serif başlıklar; teknik/kod içerik için monospace accent.
- **İkonografi:** İnce çizgi (line) ikonlar — teknik ama sıcak.
- **Diyagramlar:** Sade kutu-ok akış şemaları, monospace etiketler; süsleme yok.
- **Ton:** Kendinden emin, abartısız. Dürüst karşılaştırma (rakiplerin güçlü yanını da söylemek) güven verir — bunu koru.

---

## Slayt planı

### Slayt 1 — Kapak
- **Ana mesaj:** Arclight — Arc için Kubernetes-native event indexer
- **Alt başlık:** "ABI'ni ver, zincir event'lerin kendi Postgres'inde. 2-3 YAML ile."
- **Görsel:** Logo alanı + "arc light" ışık motifi; koyu zemin, accent parıltı.

### Slayt 2 — Problem
- **Ana mesaj:** On-chain veriye erişim bugün kırık.
- **Maddeler:**
  - Rate-limit ve gecikme (analitik API'ler)
  - Ham loglar: decode + reorg + failover yükü tamamen sende
  - Provider/network patlarsa pipeline sessizce kör kalıyor
  - Herkes aynı indexer boilerplate'ini yeniden yazıyor
- **Görsel:** 4 pain-point ikonu; kesik sinyal / kırık boru metaforu.

### Slayt 3 — Mevcut seçenekler yetersiz
- **Ana mesaj:** Her yolun bir bedeli var.
- **4 kart (her birinde ✓ / ✗):**
  - **Dune** — ✓ analitik & SQL keşfi · ✗ rate-limit, gecikme, kontrol sende değil
  - **Ham RPC log (Alchemy)** — ✓ maksimum esneklik · ✗ decode/reorg/failover hepsi sende
  - **The Graph** — ✓ olgun & güçlü · ✗ subgraph + GraphQL + ağır ops
  - **Kendin yaz** — ✓ tam kontrol · ✗ tekrar tekrar aynı boilerplate
- **Görsel:** 4 kart yan yana.

### Slayt 4 — Neden Arc, neden şimdi
- **Ana mesaj:** Arc, güvenilir indexing için elverişli — ve erken.
- **Maddeler:**
  - EVM-uyumlu → standart JSON-RPC + ABI decode olduğu gibi geçerli
  - BFT (Malachite) **deterministik finality** → finalize blok reorg olmaz → daha basit, daha güvenilir indexer
  - Yeni ağ → olgun araçlar (Dune tabloları, hazır subgraph'ler) henüz yok → erken kurmak stratejik
- **Görsel:** "finalized = kilitli blok" ikonu; "şimdi buradayız" mini timeline.

### Slayt 5 — Çözüm: Arclight
- **Ana mesaj:** Bir Kubernetes Operator: sen tanımla, o kursun.
- **Büyük vaat (öne çıkar):** 2-3 YAML → çalışan, tam bir indexer.
- **Maddeler:** declaratif & GitOps-uyumlu · self-healing · kendi Postgres'in · her event kendi tablosunda · doğrudan SQL
- **Görsel:** Büyük akış: `YAML  →  [ Arclight ]  →  çalışan indexer`

### Slayt 6 — Nasıl çalışır (mimari)
- **Ana mesaj:** Dört bileşen, tek CR'dan doğar.
- **Maddeler:** Operator (control plane) · Indexer Worker (dinleyici) · PostgreSQL (3 mod: Embedded / Service / External) · PostgREST (opsiyonel API)
- **Görsel:** Aşağıdaki akış diyagramını temiz biçimde yeniden çiz.

### Slayt 7 — Developer Experience
- **Ana mesaj:** Kurulum = birkaç manifest.
- **Görsel:** Aşağıdaki YAML snippet'i kod bloğu olarak; yanında ok: "kubectl apply → Postgres + şema + worker + API otomatik kurulur."

### Slayt 8 — Asıl değer: güvenilirlik
- **Ana mesaj:** Network patlasa bile veri kaybolmaz.
- **Maddeler:**
  - Gap-free backfill + cursor → restart'ta kaldığı yerden devam
  - `finalized`'a kadar reorg-safe (Arc'ta reorg penceresi minimal)
  - Health-check'li **RPC failover** havuzu
  - Idempotent yazım → pratikte exactly-once
- **Görsel:** "kesinti → kaldığı yerden devam" zaman çizgisi + failover ikonu.

### Slayt 9 — Her event kendi tablosunda
- **Ana mesaj:** ABI'den otomatik şema, doğrudan SQL.
- **Maddeler:** her event → ayrı tablo · ABI tipleri doğru eşlenir (`uint256 → numeric(78,0)` vb.) · `(block, tx, log)` UNIQUE (duplikasyon yok) · hazır view'lar · opsiyonel PostgREST → REST/GraphQL
- **Görsel:** `ABI JSON → tablo şeması` dönüşümü; küçük bir `SELECT` örneği.

### Slayt 10 — Kıyas
- **Ana mesaj:** Özgün birleşim: kendi DB + SQL + self-hosted + kod yazmadan + Kubernetes-native.
- **Görsel:** Aşağıdaki karşılaştırma tablosu.
- **Alt not:** "Analitik → Dune; hosted çok-zincir → The Graph. En yakın komşu Ponder — ama o bir *framework* (TS yazarsın), Arclight *declaratif operatör*."

### Slayt 11 — Yol haritası & kapsam
- **Ana mesaj:** Net bir v1, kademeli büyüme.
- **3 aşama (timeline):**
  - **v1 (MVP):** tek CRD · 3 DB modu · gap-free ingestion · ABI→şema · idempotent · cursor/resume · RPC failover · metrics + status · SQL view
  - **v1.1:** PostgREST · reorg-rollback (tip) · WebSocket düşük-gecikme
  - **v2:** Hasura/GraphQL · multi-tenant DB · backfill paralelizmi · ABI-migration UX
- **Non-goals:** analitik/BI aracı değil · genel çok-zincir hosted servis değil · zincir-üstü yazma yok

### Slayt 12 — Kapanış / İstenen
- **Ana mesaj:** v1'i kuralım.
- **Metin:** "Kendi verimiz, kendi Postgres'imizde, güvenilir ve az bakımla — Arc'ta erken davranarak. Öneri: v1 (MVP) için ilerleyelim."
- **Görsel:** Tagline tekrarı + accent CTA.

---

## Yeniden kullanılabilir asset'ler

### Tagline
> **Arclight** — ABI'ni ver, zincir event'lerin kendi Postgres'inde. 2-3 YAML ile.

### Akış diyagramı (temiz yeniden çizilecek)
```
   kubectl apply (2-3 YAML)
   ├─ ConfigMap: ABI(ler)
   ├─ Indexer (CR): rpc[], contracts[], storage modu
   └─ (Secret: DSN/cred — Service/External modda)
            │  reconcile
            ▼
   ┌─────────────────────┐        ┌───────────────────────────────┐
   │  Arclight Operator   │  ───▶  │  kurar / yönetir:             │
   │  (controller)        │        │   • Postgres (Embedded modda) │
   └─────────────────────┘        │   • schema + event tabloları  │
                                   │   • Indexer Worker            │
                                   │   • PostgREST (opsiyonel)     │
                                   └───────────────────────────────┘

   Arc RPC'ler ─▶ [ Indexer Worker ] ─▶ [ PostgreSQL ] ─▶ SQL / PostgREST ─▶ tüketiciler
                   failover · cursor       her event
                   reorg-safe · decode     kendi tablosunda
```

### YAML snippet (DX slaytı için)
```yaml
apiVersion: arclight.dev/v1alpha1
kind: Indexer
metadata: { name: usdc-arc }
spec:
  network:
    chainId: 0                       # <arc-chain-id>
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
      events: [ Transfer, Approval ]  # boş = ABI'deki tüm event'ler
  api:
    enabled: true
    kind: PostgREST                  # opsiyonel otomatik REST/GraphQL
```

### Karşılaştırma tablosu
| | Dune | Alchemy (ham log) | The Graph | Ponder | **Arclight** |
|---|---|---|---|---|---|
| Veri kendi DB'nde | Hayır | Kurarsan | graph-node ile | Evet | **Evet** |
| Doğrudan SQL | Evet | Hayır | Hayır (GraphQL) | Evet | **Evet** |
| Self-hosted | Hayır | Kısmi | Opsiyonel (ağır) | Evet | **Evet** |
| Rate-limit derdi | Var | Var | Hosted'da var | RPC'ne bağlı | **RPC'ne bağlı +failover** |
| Reorg/gap dayanıklılığı | Onlarda | Sizde | Var | Var | **Var (built-in)** |
| Kod yazmadan | SQL | Uygulama | Subgraph | TS | **Evet (YAML)** |
| K8s-native yaşam döngüsü | – | – | Manuel | Manuel | **Evet** |
| Kurulum eforu | Düşük | Yüksek | Orta-Yüksek | Orta | **Düşük (2-3 YAML)** |

### Anahtar cümleler (slaytlarda vurgu için)
- "2-3 YAML → çalışan, tam bir indexer."
- "Network patlasa bile veri kaybolmaz — gap-free, reorg-safe, RPC failover."
- "Her event kendi tablosunda, doğrudan SQL ile."
- "Arc'ın deterministik finality'si indexer'ı hem basit hem güvenilir kılıyor."
- "Kendi verin, kendi Postgres'inde — kod yazmadan."

---

*Not: Arc'a özel değerler (chainId, RPC uçları) doğrulanacak; slaytlarda placeholder olarak bırakılabilir.*
