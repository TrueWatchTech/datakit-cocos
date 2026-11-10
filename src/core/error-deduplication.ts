interface ViewErrors {
  errors: Set<string>;
  pending: number;
  bytes: number;
}

export interface FTErrorReservation {
  commit(): void;
  release(): void;
}

/** Keeps exact error identities for recent native views, including queued errors. */
export class FTViewErrorDeduplicator {
  private readonly views = new Map<string, ViewErrors>();
  private bytes = 0;

  constructor(
    private readonly maxViews = 16,
    private readonly maxErrorsPerView = 128,
    private readonly maxBytes = 1024 * 1024,
  ) {}

  reserve(viewId: string, type: string, message: string, stack: string): FTErrorReservation | undefined {
    // Length prefixes preserve field boundaries without hashing collisions.
    const key = `${type.length}:${type}${message.length}:${message}${stack.length}:${stack}`;
    const bytes = 2 * key.length;
    if (!viewId || bytes > this.maxBytes) return undefined;
    let view = this.views.get(viewId);
    if (view) {
      this.views.delete(viewId);
      this.views.set(viewId, view);
      if (view.errors.has(key) || view.errors.size >= this.maxErrorsPerView) return undefined;
    }
    // Never evict individual errors from a retained view: doing so can restart a storm.
    while ((!view && this.views.size >= this.maxViews) || this.bytes + bytes > this.maxBytes) {
      let evicted: string | undefined;
      this.views.forEach((candidate, id) => {
        if (evicted !== undefined || id === viewId || candidate.pending) return;
        evicted = id;
        this.bytes -= candidate.bytes;
      });
      if (evicted === undefined) return undefined;
      this.views.delete(evicted);
    }
    if (!view) {
      view = { errors: new Set(), pending: 0, bytes: 0 };
      this.views.set(viewId, view);
    }
    const bucket = view;
    bucket.errors.add(key);
    bucket.pending++;
    bucket.bytes += bytes;
    this.bytes += bytes;
    let pending = true;
    const finish = (keep: boolean): void => {
      if (!pending) return;
      pending = false;
      bucket.pending--;
      if (!keep) {
        bucket.errors.delete(key);
        bucket.bytes -= bytes;
        this.bytes -= bytes;
      }
    };
    return { commit: () => finish(true), release: () => finish(false) };
  }
}

// All subscribers to the same JSB source observe the same native view namespace.
const deduplicators = new WeakMap<object, FTViewErrorDeduplicator>();

export function viewErrorDeduplicator(source: object): FTViewErrorDeduplicator {
  let deduplicator = deduplicators.get(source);
  if (!deduplicator) {
    deduplicator = new FTViewErrorDeduplicator();
    deduplicators.set(source, deduplicator);
  }
  return deduplicator;
}
