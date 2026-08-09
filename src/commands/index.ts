/**
 * Command composition: what capabilities mean, and which commands exist.
 *
 * This is the only file that knows both `policyState` and the registry, which keeps
 * the registry itself testable in node.
 */

import { policyState } from '../app/config';
import { setStatus } from '../components/output';
import { CommandRegistry } from './registry.ts';
import type { Capability } from './registry.ts';
import { t } from '../i18n/index.ts';

export { CommandRegistry } from './registry.ts';
export { bindButton, bindKeybinding } from './bindings.ts';

/**
 * The four axes Step-Up negotiates over postMessage, mapped to the live policy.
 *
 * `edit` and `structure` are separate because a task can legitimately want the
 * student editing one supplied file but not adding, renaming or deleting files.
 */
function isCapabilityAllowed(capability: Capability): boolean {
  switch (capability) {
    case 'run':
      return policyState.allowRun;
    case 'edit':
      return !policyState.readonly;
    case 'structure':
      return !policyState.lockStructure;
    case 'searchReplace':
      return policyState.allowSearchReplace;
    default:
      // An unrecognised capability is refused rather than allowed. A typo in a
      // command declaration must fail closed.
      return false;
  }
}

/** Human-readable refusals, so a blocked action explains itself. */
const REFUSAL_KEYS: Record<Capability, string> = {
  run: 'policy.runDisabled',
  edit: 'policy.readonly',
  structure: 'policy.structureLocked',
  searchReplace: 'policy.searchReplaceDisabled',
};

export function createCommandRegistry(): CommandRegistry {
  return new CommandRegistry({
    isAllowed: isCapabilityAllowed,
    onRefused: (command, outcome) => {
      // Silence is what made the old behaviour confusing in the other direction:
      // a student pressing Ctrl+Enter in a read-only task should be told why
      // nothing happened, not left wondering whether the IDE is broken.
      const message =
        outcome.status === 'refused' && outcome.capability
          ? t(REFUSAL_KEYS[outcome.capability])
          : t('policy.commandUnavailable', { command: t(command.title) });
      setStatus(message);
    },
  });
}
