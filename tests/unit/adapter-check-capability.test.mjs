/**
 * Which adapters must implement `check()`, and why that is not a style preference.
 *
 * Live error checking asks the real compiler through `pipeline.check()`. For most
 * languages that is just `prepare()`: javac, tsc, `php -l`, `node --check` and the
 * Python preflight all compile DURING preparation, so preparing successfully already
 * means the project compiles.
 *
 * C# does not. Its launch is `dotnet run`, which compiles as part of EXECUTING, so
 * preparing a broken C# project succeeds and the check called it clean - a student was
 * told their file was fine and then watched it fail to run, which is worse than having
 * no check at all. An adapter in that position implements `check()` to compile
 * explicitly.
 *
 * This is a structural guard rather than a behavioural one: the behavioural tests are
 * in tests/contract/live-check.test.mjs and they skip wherever a toolchain is absent -
 * including the authoring host, which is how the C# gap reached CI in the first place.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { csharpAdapter } from '../../server/languages/adapters/csharp.mjs';
import { javaAdapter } from '../../server/languages/adapters/java.mjs';
import { javascriptAdapter } from '../../server/languages/adapters/javascript.mjs';
import { pythonAdapter } from '../../server/languages/adapters/python.mjs';

describe('the check capability', () => {
  test('C# implements check(), because it compiles at run time', () => {
    assert.equal(
      typeof csharpAdapter.check,
      'function',
      'without this, /api/check reports every broken C# project as clean',
    );
  });

  test('adapters that compile during prepare do not need one', () => {
    // Not a prohibition - it is a statement that prepare() is already the check for
    // these, so adding one would be a second implementation of the same compile.
    for (const adapter of [pythonAdapter, javaAdapter, javascriptAdapter]) {
      assert.equal(typeof adapter.check, 'undefined', `${adapter.id} should not need check()`);
    }
  });

  test('every adapter still has the prepare() the run path uses', () => {
    for (const adapter of [pythonAdapter, javaAdapter, javascriptAdapter, csharpAdapter]) {
      assert.equal(typeof adapter.prepare, 'function', adapter.id);
    }
  });
});
