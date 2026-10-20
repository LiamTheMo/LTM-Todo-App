export type StateSource = "edit" | "sync";
export type LocalEditQueueOptions<T> = {
  /** Commits `value`; must reject when storage is no longer at `expectedGeneration`. */
  write(value: T, expectedGeneration: number): Promise<void>;
  /** Shows a new state: an optimistic or replayed local edit, or state committed by sync. */
  show(value: T, source: StateSource): void;
};

/**
 * Serializes local edits with sync work that commits state outside them. Edits show immediately and persist in
 * order; if sync committed newer state after an edit was made, the edit is replayed on that state instead of
 * overwriting it or failing the generation check.
 */
export class LocalEditQueue<T extends { generation: number }> {
  private shown: T;
  private stored: T;
  private tail: Promise<void> = Promise.resolve();
  private readonly options: LocalEditQueueOptions<T>;

  constructor(initial: T, options: LocalEditQueueOptions<T>) {
    this.shown = initial;
    this.stored = initial;
    this.options = options;
  }

  /** The newest state, including optimistic edits that are not committed yet. */
  get current(): T { return this.shown; }

  /** Sets the state read from storage; call before any edit. */
  load(value: T): void { this.shown = value; this.stored = value; }

  /**
   * Applies an edit now and commits it after earlier work. `apply` must be pure: it may run again on newer state,
   * and it returns its input unchanged for a no-op. Resolves true when something was committed.
   */
  edit(apply: (base: T) => T): Promise<boolean> | undefined {
    const previous = this.shown;
    const next = apply(previous);
    if (next === previous) return;
    this.shown = next;
    this.options.show(next, "edit");
    const done = this.tail.then(async () => {
      const base = this.stored;
      const value = base === previous ? next : apply(base);
      if (value !== base) {
        await this.options.write(value, base.generation);
        this.stored = value;
      }
      // A later edit that is still queued shows its own replayed state when it commits.
      if (value !== next && this.shown === next) {
        this.shown = value;
        this.options.show(value, "edit");
      }
      return value !== base;
    });
    this.tail = done.then(() => undefined, () => undefined);
    return done;
  }

  /**
   * Runs work that commits state itself (pulling remote changes, resolving conflicts) after queued edits. The work
   * calls `adopt` with the state it committed; edits queued behind it replay on that state.
   */
  run<R>(work: (adopt: (committed: T) => void) => Promise<R>): Promise<R> {
    const adopt = (committed: T) => {
      const editsQueued = this.shown !== this.stored;
      this.stored = committed;
      if (editsQueued) return;
      this.shown = committed;
      this.options.show(committed, "sync");
    };
    const done = this.tail.then(() => work(adopt));
    this.tail = done.then(() => undefined, () => undefined);
    return done;
  }

  /** Resolves once all queued work has finished, whether or not it succeeded. */
  settled(): Promise<void> { return this.tail; }
}
