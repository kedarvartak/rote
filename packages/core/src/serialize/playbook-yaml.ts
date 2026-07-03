import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PlaybookSchema, type Playbook } from '../schemas/playbook.js';

/**
 * Serializes a Playbook to human-readable YAML. Playbooks are meant to be
 * audited by a person, not just executed — see docs/02-architecture.md
 * "What Rote is not": humans never author playbooks, but they must be able
 * to read one.
 */
export function writePlaybookYaml(playbook: Playbook): string {
  return stringifyYaml(playbook);
}

/** Parses and fully validates a playbook YAML document. */
export function parsePlaybookYaml(text: string): Playbook {
  const raw: unknown = parseYaml(text);
  return PlaybookSchema.parse(raw);
}
