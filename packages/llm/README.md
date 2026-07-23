# @rote/llm

Shared source-tagged LLM boundary for Rote. Provider SDK calls belong here so planner,
matcher, slot, repair, verification, and distillation usage is attributed consistently.
The client accepts separately assembled stable and volatile prompt sections.

## Public API

- `TaggedLlmClient` — provider-neutral completion boundary requiring a `source` tag and retaining the real provider/model usage receipt for benchmark audit.
- `AnthropicTaggedLlmClient` — Anthropic implementation using `ANTHROPIC_API_KEY`.
- `OpenAiTaggedLlmClient` — OpenAI Responses API implementation using `OPENAI_API_KEY`; routes the SHA-256 digest of the exact stable prefix through `prompt_cache_key` without adding prompt tokens.
- `openAiPromptCacheKey(prefix)` — deterministic privacy-preserving cache-routing key used by the OpenAI client.
- `createTaggedLlmClientFromEnv()` — selects `ROTE_LLM_PROVIDER=openai|anthropic`; defaults to OpenAI so `ANTHROPIC_API_KEY` is never required unless explicitly selected.

## Running tests

```bash
npm test --workspace @rote/llm
```
