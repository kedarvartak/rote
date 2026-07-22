import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const verifier = fileURLToPath(new URL('../../../scripts/bench/curve/wordpress/verify-trash-posts.sh', import.meta.url));
const corpusVerifier = fileURLToPath(new URL('../../../scripts/bench/curve/wordpress/verify-corpus.sh', import.meta.url));
const exactCorpus = Array.from({ length: 120 }, (_, index) => ({
  post_title: `Rote curve post ${String(index + 1).padStart(3, '0')}`,
  post_status: 'publish',
}));

describe('WordPress curve title verifier', () => {
  it('accepts the exact expected title set regardless of order', async () => {
    const result = await run(verifier, [JSON.stringify(['Rote curve post 120', 'Rote curve post 119'])], {
      env: { ...process.env, ROTE_CURVE_ACTUAL_TITLES_JSON: JSON.stringify(['Rote curve post 119', 'Rote curve post 120']) },
    });
    expect(result.stdout).toContain('verified trashed posts');
  });

  it('rejects the right count with the wrong post identity', async () => {
    await expect(run(verifier, [JSON.stringify(['Rote curve post 120'])], {
      env: { ...process.env, ROTE_CURVE_ACTUAL_TITLES_JSON: JSON.stringify(['Rote curve post 117']) },
    })).rejects.toMatchObject({ code: 1 });
  });

  it('accepts exactly the deterministic published corpus', async () => {
    await expect(run(corpusVerifier, [], {
      env: { ...process.env, ROTE_CURVE_CORPUS_JSON: JSON.stringify(exactCorpus) },
    })).resolves.toMatchObject({ stdout: expect.stringContaining('verified exact 120-post curve corpus') });
  });

  it('rejects the stock WordPress post even when all benchmark posts exist', async () => {
    await expect(run(corpusVerifier, [], {
      env: {
        ...process.env,
        ROTE_CURVE_CORPUS_JSON: JSON.stringify([...exactCorpus, { post_title: 'Hello world!', post_status: 'publish' }]),
      },
    })).rejects.toMatchObject({ code: 1 });
  });
});
