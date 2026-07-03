export type Phase = 'Provisioning' | 'Backfilling' | 'Live' | 'Degraded';

export class PhaseTracker {
  #phase: Phase = 'Provisioning';
  #lastError: string | undefined;

  get phase(): Phase {
    return this.#phase;
  }
  get lastError(): string | undefined {
    return this.#lastError;
  }
  get healthy(): boolean {
    return this.#phase !== 'Degraded';
  }
  set(phase: Phase, error?: string): void {
    this.#phase = phase;
    this.#lastError = error;
  }
}
