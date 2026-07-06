export type Phase = 'Provisioning' | 'Backfilling' | 'Live' | 'Degraded';

export class PhaseTracker {
  #phase: Phase = 'Provisioning';
  #lastError: string | undefined;
  #currentBlock = 0n;
  #headBlock = 0n;

  get phase(): Phase {
    return this.#phase;
  }
  get lastError(): string | undefined {
    return this.#lastError;
  }
  get healthy(): boolean {
    return this.#phase !== 'Degraded';
  }
  get currentBlock(): bigint {
    return this.#currentBlock;
  }
  get headBlock(): bigint {
    return this.#headBlock;
  }
  get lag(): bigint {
    const d = this.#headBlock - this.#currentBlock;
    return d > 0n ? d : 0n;
  }
  set(phase: Phase, error?: string): void {
    this.#phase = phase;
    this.#lastError = error;
  }
  setBlocks(current: bigint, head: bigint): void {
    this.#currentBlock = current;
    this.#headBlock = head;
  }
}
