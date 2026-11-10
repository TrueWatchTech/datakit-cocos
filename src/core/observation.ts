/** Shared across the early JSB bootstrap and the separately bundled SDK runtime. */
export interface FTObservationState { reporting: number; }
export interface FTObservationGlobal {
  __FT_COCOS_OBSERVATION_STATE__?: FTObservationState;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export function observationState(target: FTObservationGlobal): FTObservationState {
  return target.__FT_COCOS_OBSERVATION_STATE__
    || (target.__FT_COCOS_OBSERVATION_STATE__ = { reporting: 0 });
}

/** A bounded, cancellable side channel. It never runs a task synchronously. */
export class FTObservationQueue {
  private readonly state: FTObservationState;
  private cancel: typeof clearTimeout | undefined;
  private pending: Array<{ run: () => void; size: number }> = [];
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  dropped = 0;

  constructor(private readonly target: FTObservationGlobal) {
    this.state = observationState(target);
  }

  enqueue(run: () => void, size = 0): boolean {
    if (this.state.reporting) return false;
    if (this.pending.length >= 128 || this.size + size > 1024 * 1024) {
      this.dropped++;
      return false;
    }
    this.pending.push({ run, size });
    this.size += size;
    if (this.timer !== undefined) return true;
    const generation = this.generation;
    try {
      // Editor/module import may precede timer installation. Resolve only when
      // an observation actually needs scheduling; absence never means sync work.
      const schedule = this.target.setTimeout || (typeof setTimeout === 'function' ? setTimeout : undefined);
      const cancel = this.target.clearTimeout || (typeof clearTimeout === 'function' ? clearTimeout : undefined);
      if (!schedule) {
        this.dropped += this.pending.length;
        this.pending = [];
        this.size = 0;
        return false;
      }
      this.cancel = cancel?.bind(this.target);
      this.timer = schedule.call(this.target, () => {
        this.timer = undefined;
        if (generation !== this.generation) return;
        const batch = this.pending;
        this.pending = [];
        this.size = 0;
        this.state.reporting++;
        try {
          for (const task of batch) {
            if (generation !== this.generation) break;
            try { task.run(); } catch { /* Never report observation failures through the observed channel. */ }
          }
        } finally {
          this.state.reporting--;
        }
      }, 0);
      return true;
    } catch {
      this.dropped += this.pending.length;
      this.pending = [];
      this.size = 0;
      return false;
    }
  }

  stop(): void {
    this.generation++;
    this.pending = [];
    this.size = 0;
    if (this.timer !== undefined) {
      try { this.cancel?.(this.timer); } catch { /* The generation check also invalidates the callback. */ }
      this.timer = undefined;
    }
  }
}
