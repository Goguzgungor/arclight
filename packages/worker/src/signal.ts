export interface HeadInfo {
  number: bigint;
  timestamp: Date;
}

// Latch between the newHeads signal and the pipeline wake-up, plus the
// announcement data. A signal arriving while no one is waiting is stored as a
// flag, and N back-to-back signals cause a single wake-up. The highest block
// announced by the primary connection becomes the hot-path target (in 'latest'
// mode this removes the getBlock RTT and the announcing-node/query-node
// divergence); the timestamps of all announcements are written to the
// block-time cache (cutting the getBlockTimes RTT).
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
