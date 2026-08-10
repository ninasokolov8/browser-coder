import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  CSHARP_NUGET_CONFIG,
  offlineRestoreArgs,
} from '../../server/languages/adapters/csharp.mjs';

describe('C# restore is deterministic and offline', () => {
  test('the service-owned NuGet configuration clears inherited package feeds', () => {
    assert.match(CSHARP_NUGET_CONFIG, /<packageSources>\s*<clear\s*\/>\s*<\/packageSources>/);
    assert.match(CSHARP_NUGET_CONFIG, /<auditSources>\s*<clear\s*\/>\s*<\/auditSources>/);
    assert.doesNotMatch(CSHARP_NUGET_CONFIG, /https?:\/\//i);
  });

  test('restore explicitly selects that configuration', () => {
    const args = offlineRestoreArgs('/jobs/example');
    assert.deepEqual(args.slice(0, 2), ['restore', 'UserProgram.csproj']);
    assert.equal(
      args[args.indexOf('--configfile') + 1],
      path.join('/jobs/example', '.browser-coder.NuGet.Config'),
    );
    assert.doesNotMatch(args.join(' '), /https?:\/\//i);
  });
});
