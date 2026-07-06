# Arclight — WS-Hibrit Dinleme (WebSocket newHeads + Polling Fallback)

> Durum: Onaylanmış tasarım · Tarih: 2026-07-06
> Kaynak: MVP tasarımındaki (§9 yol haritası, v1.1) "WebSocket düşük-gecikme takibi"
> maddesinin öne çekilmesi. Kullanıcı kararı: WS ana dinleme mekanizması olsun,
> polling güvenlik ağı olarak kalsın; okumalar da mümkünse WS üzerinden gitsin.

## 1. Amaç ve Kapsam

Worker bugün zinciri sabit aralıklı HTTP polling ile izliyor (`intervalMs`, vars.
2 sn): boşta bile her tur `getBlock(finalized)` çağrısı yapar ve yeni bloğu en
kötü `intervalMs` gecikmeyle görür. Bu tasarım worker'ı **push tabanlı** hale
getirir: sağlıklı bir WebSocket ucu varsa `eth_subscribe(newHeads)` aboneliği
açılır ve yeni blok sinyali pipeline'ı **anında** uyandırır. Okuma çağrıları
(getLogs/getBlock) da WS transport üzerinden gidebilir.

### Değişmeyen sözleşmeler (non-goals)

- **Finalized-only kalır:** finalize olmamış (tip) event'ler DB'ye yazılmaz;
  reorg-rollback yok. WS yalnızca *uyandırma sinyali* ve *transport*tur, yazma
  yolunu değiştirmez.
- Cursor + tek-tx exactly-once semantiği, tablo şemaları, CRD'nin veri modeli
  aynen korunur.
- `eth_subscribe('logs')` ile doğrudan event ingest **yapılmaz** (kaçırılan
  event/kopukluk riski; doğruluk yine cursor+getLogs'tan gelir).

## 2. Konfigürasyon (CRD/Config)

Yeni alan yok. Mevcut `network.rpc` listesi `ws://` ve `wss://` URL'leri de
kabul eder:

```yaml
network:
  chainId: 5042002
  rpc:
    - wss://arc-testnet.drpc.org      # WS: abonelik + okuma
    - https://arc-testnet.drpc.org    # HTTP: fallback
```

- Zod şeması ve CRD'deki alan açıklaması `http(s)://` ve `ws(s)://` şemalarını
  belirtir; başka şema reddedilir.
- Listede hiç ws URL yoksa davranış bugünküyle **birebir aynıdır** (salt
  polling). Geriye dönük uyumluluk tamdır; mevcut CR'lar değişmeden çalışır.

## 3. Bileşenler

### 3.1 rpc.ts — transport havuzu ve abonelik

- `splitRpcUrls(urls)` → `{ http: string[], ws: string[] }` (şemaya göre).
- `filterHealthyRpcs` her iki türe de chainId sorar (ws için viem `webSocket`
  transport'uyla).
- `createRpc` viem `fallback` havuzunu şöyle kurar: sağlıklı **ws** uçları
  `webSocket(...)` transport, **http** uçları `http(...)` transport olarak aynı
  ranked havuza girer → getLogs/getBlock mümkünse WS üzerinden gider, WS
  sorunluysa viem otomatik http'ye düşer.
- Yeni `subscribeNewHeads(wsUrls, onHead, onStateChange)`: ilk sağlıklı ws
  ucundan ayrı bir subscription client ile `newHeads` aboneliği açar.
  - Kopunca üstel backoff'la (1 sn → 30 sn) sıradaki ws ucunu dener.
  - Bağlantı durumunu `onStateChange(connected: boolean)` ile bildirir.
  - Dönen `close()` fonksiyonu graceful shutdown'da çağrılır.

### 3.2 pipeline.ts — sinyal-veya-timeout bekleyişi

- Küçük bir `HeadSignal` latch'i: `notify()` bekleyen promise'i çözer; bekleyen
  yoksa bayrak koyar (sinyal kaybolmaz), `wait(ms, signal)` → sinyal VEYA
  timeout VEYA abort'tan hangisi önce gelirse döner.
- `runLoop` boşta `sleep(intervalMs)` yerine `headSignal.wait(intervalMs, ...)`
  kullanır. `intervalMs` artık *maksimum* bekleme (güvenlik ağı): WS ölü olsa
  bile en geç `intervalMs`'te bir tur atılır.
- Backfill/catch-up davranışı değişmez (`progressed` olduğu sürece döngü zaten
  beklemeden devam eder). Hata backoff'u da aynen kalır.

### 3.3 main.ts — kablolama

- ws URL varsa `subscribeNewHeads` başlatılır; `onHead` → `headSignal.notify()`
  + `headNotifications` sayacı; `onStateChange` → `wsConnected` gauge.
- Shutdown: `SIGTERM/SIGINT` → abonelik `close()` + mevcut abort akışı.

## 4. Dayanıklılık ve Hata Modları

| Durum | Davranış |
|---|---|
| ws URL yok | Bugünkü salt-polling; hiçbir yeni kod yolu devreye girmez. |
| WS kopar | Polling `intervalMs` aralığıyla devam eder; abonelik backoff'la yeniden bağlanır. Faz **Degraded yapılmaz** (veri akışı bozulmuyor), sadece `arclight_ws_connected=0`. |
| Tüm ws uçları sağlıksız (açılışta) | Loglanır, salt-polling'e düşülür; abonelik denemeleri arka planda sürer. |
| Sinyal fırtınası (çok hızlı bloklar) | Latch tek bayraktır; art arda N sinyal tek tura yol açar, tur zaten aralığı toplu işler (`batchBlocks`). |

## 5. Gözlemlenebilirlik

- `arclight_ws_connected{indexer}` gauge (0/1).
- `arclight_head_notifications_total{indexer}` sayaç.
- Log: abonelik açıldı/koptu/yeniden bağlandı (uç URL'iyle).

## 6. Test Stratejisi

- **Unit:** `splitRpcUrls` (şema ayrımı, geçersiz şema reddi), `HeadSignal`
  latch'i (sinyal-önce/bekleme-önce/abort/kayıpsızlık), abonelik backoff'u
  (sahte client'la).
- **Entegrasyon:** anvil WS'i aynı portta sunar (`ws://127.0.0.1:8545`) —
  gerçek newHeads aboneliğiyle "yeni blok → intervalMs beklemeden tur" ve
  "WS kapat → polling devam" senaryoları.
- **e2e:** demo Indexer CR'ın `rpc` listesine `ws://anvil:8545` eklenir
  (`http://anvil:8545` fallback kalır); Live fazı + 10 satır doğrulaması aynı.
- **Arc testnet:** `arc:preflight` script'ine ws ucu chainId kontrolü eklenir.

## 7. Dokümantasyon

- README mimari şeması: "poll" → "WS newHeads + poll fallback".
- MVP tasarım dokümanına bu spec'e işaret eden not (v1.1 maddesi öne çekildi).
