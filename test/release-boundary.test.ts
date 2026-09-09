import { describe, expect, it } from 'vitest';
import { validateReleaseTag, verifyRelease } from '../scripts/verify-release.mjs';

describe('TrueWatch release boundary', () => {
  it('validates package metadata without requiring a release tag for branch builds', () => {
    expect(() => verifyRelease('')).not.toThrow();
  });

  it.each(['agent_0.1.0-alpha.1', 'tw_agent_0.1.0-alpha.1'])(
    'does not treat %s as a new TrueWatch release', (tag) => {
      expect(() => validateReleaseTag(tag, '0.1.0-alpha.1')).toThrow('must start after');
    },
  );

  it.each(['0.1.0-alpha.2', '0.1.0-beta.1', '0.1.0', '0.2.0-alpha.1'])(
    'accepts a matching future version %s', (version) => {
      expect(() => validateReleaseTag(`tw_agent_${version}`, version)).not.toThrow();
      expect(() => validateReleaseTag(`agent_${version}`, version)).not.toThrow();
    },
  );

  it.each(['0.1.0-alpha.0', '0.0.9', '0.1.0-rc.1'])(
    'rejects an older or unsupported version %s', (version) => {
      expect(() => validateReleaseTag(`tw_agent_${version}`, version)).toThrow();
    },
  );

  it('rejects mismatched versions and unrelated tag formats', () => {
    expect(() => validateReleaseTag('tw_agent_0.1.0-alpha.2', '0.1.0-alpha.1')).toThrow('does not match');
    expect(() => validateReleaseTag('tw_0.1.0-alpha.2', '0.1.0-alpha.2')).toThrow('Unsupported');
  });
});
