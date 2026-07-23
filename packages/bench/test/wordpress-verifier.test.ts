import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const verifier = fileURLToPath(new URL('../../../scripts/bench/curve/wordpress/verify-trash-posts.sh', import.meta.url));
const corpusVerifier = fileURLToPath(new URL('../../../scripts/bench/curve/wordpress/verify-corpus.sh', import.meta.url));
const reviewVerifier = fileURLToPath(new URL('../../../scripts/bench/curve/wordpress/verify-reviewed-posts.sh', import.meta.url));
const tagVerifier = fileURLToPath(new URL('../../../scripts/bench/curve/wordpress/verify-created-tags.sh', import.meta.url));
const exactCorpus = Array.from({ length: 120 }, (_, index) => ({
  post_title: `Rote curve post ${String(index + 1).padStart(3, '0')}`,
  post_status: 'publish',
}));
const contentCorpus = exactCorpus.map((post, index) => ({
  ...post,
  post_content: `Procurement record ${String(index + 1).padStart(3, '0')} for the deterministic Rote working-memory benchmark.`,
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

  it('accepts exact reviewed titles while requiring every non-target post unchanged', async () => {
    const reviewed = contentCorpus.map((post) => post.post_title === 'Rote curve post 120'
      ? { ...post, post_title: `${post.post_title} — reviewed` }
      : post);
    await expect(run(reviewVerifier, [JSON.stringify(['Rote curve post 120'])], {
      env: { ...process.env, ROTE_CURVE_POSTS_JSON: JSON.stringify(reviewed) },
    })).resolves.toMatchObject({ stdout: expect.stringContaining('verified reviewed posts') });
  });

  it('rejects collateral edits outside the requested title set', async () => {
    const collateral = contentCorpus.map((post) => post.post_title === 'Rote curve post 119'
      ? { ...post, post_title: `${post.post_title} — reviewed` }
      : post);
    await expect(run(reviewVerifier, [JSON.stringify(['Rote curve post 120'])], {
      env: { ...process.env, ROTE_CURVE_POSTS_JSON: JSON.stringify(collateral) },
    })).rejects.toMatchObject({ code: 1 });
  });

  it('accepts exact unassigned tag identities while requiring the post corpus unchanged', async () => {
    const tags = [{
      name: 'Rote certification tag 01',
      slug: 'rote-certification-tag-01',
      description: 'Deterministic certification marker 01.',
      count: 0,
    }];
    await expect(run(tagVerifier, [JSON.stringify(['Rote certification tag 01'])], {
      env: {
        ...process.env,
        ROTE_CURVE_TAGS_JSON: JSON.stringify(tags),
        ROTE_CURVE_CORPUS_JSON: JSON.stringify(exactCorpus),
      },
    })).resolves.toMatchObject({ stdout: expect.stringContaining('verified created tags') });
  });

  it('rejects extra tags and incorrect tag fields', async () => {
    const tags = [
      { name: 'Rote certification tag 01', slug: 'wrong', description: 'wrong', count: 1 },
      { name: 'collateral tag', slug: 'collateral-tag', description: '', count: 0 },
    ];
    await expect(run(tagVerifier, [JSON.stringify(['Rote certification tag 01'])], {
      env: {
        ...process.env,
        ROTE_CURVE_TAGS_JSON: JSON.stringify(tags),
        ROTE_CURVE_CORPUS_JSON: JSON.stringify(exactCorpus),
      },
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
