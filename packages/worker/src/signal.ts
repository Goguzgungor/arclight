export interface HeadInfo {
  number: bigint;
  timestamp: Date;
}

// newHeads sinyali ile pipeline uyanışı arasındaki latch + duyuru verisi.
// Bekleyen yokken gelen sinyal bayrak olarak saklanır, art arda N sinyal tek
// uyanışa yol açar. Birincil bağlantının duyurduğu en yüksek blok sıcak yolun
// hedefi olur ('latest' modunda getBlock RTT'sini ve duyuran-node/sorgu-node
// ayrışmasını ortadan kaldırır); tüm duyuruların timestamp'leri blok-zamanı
// önbelleğine yazılır (getBlockTimes RTT'sini keser).
export class HeadSignal {
  private flagged = false;
  private waiter: (() => void) | null = null;
  private primaryHead: HeadInfo | null = null;
  private times = new Map<bigint, Date>();

  notify(head?: HeadInfo, primary = false): void {
    if (head) {
      if (primary && (this.primaryHead === null || head.number > this.primaryHead.number)) {
        this.primaryHead = head;
      }
      this.times.set(head.number, head.timestamp);
      if (this.times.size > 4096) {
        const oldest = this.times.keys().next().value!;
        this.times.delete(oldest);
      }
    }
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w();
    } else {
      this.flagged = true;
    }
  }

  latestPrimaryHead(): HeadInfo | null {
    return this.primaryHead;
  }

  blockTimes(): ReadonlyMap<bigint, Date> {
    return this.times;
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (this.flagged || signal.aborted) {
      this.flagged = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        this.waiter = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
      this.waiter = done;
    });
  }
}
