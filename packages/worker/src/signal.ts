// newHeads sinyali ile pipeline uyanışı arasındaki latch: bekleyen yokken gelen
// sinyal bayrak olarak saklanır, art arda N sinyal tek uyanışa yol açar.
export class HeadSignal {
  private flagged = false;
  private waiter: (() => void) | null = null;

  notify(): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w();
    } else {
      this.flagged = true;
    }
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
