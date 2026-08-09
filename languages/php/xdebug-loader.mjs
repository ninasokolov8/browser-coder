import { spawnSync } from 'node:child_process';

/**
 * Return the CLI flag needed to load Xdebug, if PHP has not loaded it already.
 *
 * Linux distributions disagree here: Alpine installs the extension without enabling
 * it, while the PHP configuration on GitHub's Ubuntu runners enables it globally.
 * Passing `-dzend_extension=xdebug` in both environments makes Ubuntu emit a warning
 * into the student's stderr. Probe the exact interpreter and hardening flags that the
 * debug run will use, then load the extension only when PHP says it is absent.
 */
export function xdebugLoadArgs(phpBin, phpArgs = [], probe = spawnSync) {
  try {
    const result = probe(
      phpBin,
      [
        ...phpArgs,
        '-r',
        'exit(extension_loaded("xdebug") ? 0 : 1);',
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        shell: false,
        windowsHide: true,
      },
    );

    if (!result.error && result.status === 0) return [];
  } catch {
    // The real launch below owns the useful missing-interpreter error.
  }

  return ['-dzend_extension=xdebug'];
}
