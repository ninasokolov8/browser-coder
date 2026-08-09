/**
 * Minimal typed event emitter.
 *
 * Deliberately not `EventTarget`: the domain must run in node for its unit
 * tests, values must pass through unwrapped rather than as `CustomEvent.detail`,
 * and listener registration must return something disposable so a component can
 * detach every subscription it made in one call.
 */

import type { Disposable } from './types.ts';

export class Emitter<T> {
  #listeners = new Set<(value: T) => void>();

  get listenerCount(): number {
    return this.#listeners.size;
  }

  event = (listener: (value: T) => void): Disposable => {
    this.#listeners.add(listener);
    return {
      dispose: () => {
        this.#listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    // Snapshot: a listener may unsubscribe itself or another during dispatch.
    for (const listener of [...this.#listeners]) {
      try {
        listener(value);
      } catch (error) {
        // An event is a notification, not a transaction. A failing observer must
        // not abort the state change that already happened, nor silence its
        // siblings - both would leave the UI describing a world that is not the
        // one in memory.
        console.error('[workspace] event listener threw', error);
      }
    }
  }

  dispose(): void {
    this.#listeners.clear();
  }
}
