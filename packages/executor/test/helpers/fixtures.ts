import { buildEnvFingerprint, PlaybookSchema, type EnvFingerprint, type Playbook, type Step } from '@rote/core';

export function fakeEnvFingerprint(): EnvFingerprint {
  return buildEnvFingerprint({
    tool_inventory: [{ name: 'echo', schema_hash: 'a'.repeat(8) }],
    target_identity: 'fake.example.com',
    surface_versions: {},
  });
}

interface PlaybookOverrides {
  steps: Step[];
  verify?: Playbook['verify'];
  params?: Playbook['params'];
}

/** Builds and validates a minimal Playbook for tests, so every fixture is schema-legitimate. */
export function makePlaybook(overrides: PlaybookOverrides): Playbook {
  return PlaybookSchema.parse({
    playbook: 'test-playbook',
    version: 1,
    task_signature: {
      intent_description: 'a test playbook',
      env_fingerprint: { domain: 'fake.example.com', tool_prefixes: ['echo'] },
    },
    params: overrides.params ?? [],
    steps: overrides.steps,
    verify: overrides.verify ?? [{ nonempty: true }],
    confidence: 1,
  }) as Playbook;
}
