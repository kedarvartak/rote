# @rote/llm

Shared source-tagged LLM boundary for Rote. Provider SDK calls belong here so planner,
matcher, slot, repair, verification, and distillation usage is attributed consistently.
The client accepts separately assembled stable and volatile prompt sections.

## Public API

- `TaggedLlmClient` — provider-neutral completion boundary requiring a `source` tag.
- `AnthropicTaggedLlmClient` — Anthropic implementation using `ANTHROPIC_API_KEY`.
- `OpenAiTaggedLlmClient` — OpenAI Responses API implementation using `OPENAI_API_KEY`.
- `createTaggedLlmClientFromEnv()` — selects `ROTE_LLM_PROVIDER=openai|anthropic`; defaults to Anthropic for backward compatibility.

## Running tests

```bash
npm test --workspace @rote/llm
```
