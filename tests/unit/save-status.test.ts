/**
 * That a student is TOLD when their work is not being saved.
 *
 * The persistence coordinator always did this part right: a failed write keeps the
 * document dirty, records the error, and fires `onDidSave` with `{ status: 'failed' }`.
 * Its own tests cover all of that. Nothing subscribed, so the one fact the student
 * needed was computed carefully and then thrown away - the IDE looked like it was
 * autosaving and was not, and the work was gone at the next reload.
 *
 * These tests are about the message reaching a person, which is why they assert on what
 * was said rather than on which methods were called.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { connectSaveStatus } from '../../src/features/save-status.ts';
import { WorkspaceService } from '../../src/workspace/service.ts';
import { MemoryWorkspaceStore } from '../../src/workspace/store.ts';

/** What was said, and what a screen reader would have heard. */
function recorder() {
  const said: string[] = [];
  const announced: string[] = [];
  return {
    said,
    announced,
    reporter: {
      status: (message: string) => said.push(message),
      announce: (message: string) => announced.push(message),
    },
  };
}

/** The page events, without a browser. */
function fakeHost() {
  const handlers = new Map<string, () => void>();
  let hidden = false;
  return {
    handlers,
    hide() {
      hidden = true;
      handlers.get('visibilitychange')?.();
    },
    host: {
      isHidden: () => hidden,
      addEventListener: (type: string, handler: () => void) => handlers.set(type, handler),
      removeEventListener: (type: string) => handlers.delete(type),
    },
  };
}

const PYTHON = { language: 'python', version: 'python3' };

function serviceWith(store: MemoryWorkspaceStore): WorkspaceService {
  let counter = 0;
  return new WorkspaceService({
    store,
    autoSaveDelayMs: 0,
    now: () => 5_000,
    newId: (kind: 'file' | 'folder') => `${kind}-${++counter}`,
  });
}

describe('a failing browser database', () => {
  test('the student is told, in words about their work', async () => {
    // Writes refused - over quota, a private window out of its allowance, a second tab
    // holding a blocked upgrade. All of these look exactly like this.
    const store = new MemoryWorkspaceStore(undefined, {
      failOn: operation => (operation === 'writeDocumentContent' ? new Error('QuotaExceededError') : null),
    });
    const service = serviceWith(store);
    await service.open();
    const { said, announced, reporter } = recorder();
    const wiring = connectSaveStatus(service, reporter, fakeHost().host);

    const created = await service.createDocument({ name: 'main.py', content: 'a\n', ...PYTHON });
    service.getDocument(created.id)!.setContent('changed\n');
    await service.flush(created.id).catch(() => {});

    const message = said.join(' | ');
    assert.match(message, /could not be saved/i, `said: ${message}`);
    assert.match(message, /copy anything important/i, 'and what to do about it');
    assert.ok(announced.length > 0, 'announced for a screen reader too');

    wiring.dispose();
  });

  test('it is said once per outage, not once per keystroke', async () => {
    const store = new MemoryWorkspaceStore(undefined, {
      failOn: operation => (operation === 'writeDocumentContent' ? new Error('QuotaExceededError') : null),
    });
    const service = serviceWith(store);
    await service.open();
    const { announced, reporter } = recorder();
    const wiring = connectSaveStatus(service, reporter, fakeHost().host);

    const created = await service.createDocument({ name: 'main.py', content: 'a\n', ...PYTHON });
    const document = service.getDocument(created.id)!;

    // Autosave retries on every change. Repeating the message each time would make the
    // live region unusable and bury everything else the IDE says.
    for (const text of ['b\n', 'c\n', 'd\n']) {
      document.setContent(text);
      await service.flush(created.id).catch(() => {});
    }

    const failures = announced.filter(line => /could not be saved/i.test(line));
    assert.equal(failures.length, 1, `announced ${failures.length} times`);

    wiring.dispose();
  });
});

describe('when saving starts working again', () => {
  test('the student is told that too', async () => {
    let refuse = true;
    const store = new MemoryWorkspaceStore(undefined, {
      failOn: operation =>
        refuse && operation === 'writeDocumentContent' ? new Error('QuotaExceededError') : null,
    });
    const service = serviceWith(store);
    await service.open();
    const { said, reporter } = recorder();
    const wiring = connectSaveStatus(service, reporter, fakeHost().host);

    const created = await service.createDocument({ name: 'main.py', content: 'a\n', ...PYTHON });
    const document = service.getDocument(created.id)!;

    document.setContent('b\n');
    await service.flush(created.id).catch(() => {});
    assert.ok(said.some(line => /could not be saved/i.test(line)));

    // Leaving the student believing their work is still being lost is its own bug.
    refuse = false;
    document.setContent('c\n');
    await service.flush(created.id);

    assert.ok(
      said.some(line => /working again/i.test(line)),
      `said: ${said.join(' | ')}`,
    );

    wiring.dispose();
  });
});

describe('the page going away', () => {
  test('hiding the tab flushes what autosave has not written yet', async () => {
    const store = new MemoryWorkspaceStore();
    const service = serviceWith(store);
    await service.open();
    const page = fakeHost();
    const wiring = connectSaveStatus(service, recorder().reporter, page.host);

    const created = await service.createDocument({ name: 'main.py', content: 'a\n', ...PYTHON });
    service.getDocument(created.id)!.setContent('typed and then the tab was closed\n');

    // The student types and immediately closes the tab. Nothing used to flush here, so
    // whatever was still inside the debounce timer was simply lost.
    page.hide();
    await new Promise(resolve => setImmediate(resolve));

    assert.match(store.peekContent(created.id) ?? '', /typed and then the tab was closed/);

    wiring.dispose();
  });

  test('disposing removes the listeners', () => {
    const service = serviceWith(new MemoryWorkspaceStore());
    const page = fakeHost();
    const wiring = connectSaveStatus(service, recorder().reporter, page.host);

    assert.ok(page.handlers.has('visibilitychange'));
    assert.ok(page.handlers.has('pagehide'));

    wiring.dispose();

    assert.equal(page.handlers.has('visibilitychange'), false);
    assert.equal(page.handlers.has('pagehide'), false);
  });
});
