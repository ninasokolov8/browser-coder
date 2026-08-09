/**
 * A stable handle to something that does not exist yet.
 *
 * Several feature modules run at import time but need the editor, the tab manager
 * or the workspace, which are constructed during bootstrap. They each solved this
 * with the same one-liner:
 *
 *     const tabManager = new Proxy({} as any, {
 *       get: (_t, p) => (runtime.tabManager as any)[p],
 *     });
 *
 * which reads the property off the real object but then calls it with `this` bound
 * to the **proxy**. That worked only by accident: every field access inside the
 * method went back through the `get` trap and was forwarded. The moment a class
 * uses real `#private` fields it breaks, with
 *
 *     TypeError: Cannot read private member #activeId from an object
 *                whose class did not declare it
 *
 * because a private slot is keyed on object identity and the proxy is a different
 * object. Found by the app-boot smoke test after `TabManager` was rewritten with
 * `#private` fields - and it would equally have broken against any dependency that
 * later adopted them, including Monaco.
 *
 * Binding methods to their real receiver fixes it for good, and keeps the
 * ergonomics the call sites were written against.
 */

export function lazyRef<T extends object>(resolve: () => T | null, name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve();
      if (!target) {
        throw new Error(`${name} was used before it was initialized`);
      }

      const value = Reflect.get(target as object, property, target);
      // Bind to the REAL object, never to the proxy, so `#private` access works.
      return typeof value === 'function' ? value.bind(target) : value;
    },

    set(_target, property, value) {
      const target = resolve();
      if (!target) {
        throw new Error(`${name} was used before it was initialized`);
      }
      return Reflect.set(target as object, property, value, target);
    },

    has(_target, property) {
      const target = resolve();
      return target ? Reflect.has(target as object, property) : false;
    },
  });
}
