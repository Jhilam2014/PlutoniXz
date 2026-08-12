# QAgent Memory Policy

QAgentic memory exists to improve future objective completion, not to store raw conversations.

## Store

- objective gaps that caused continuation;
- successful next instruction packets;
- stop decisions and reasons;
- validation failures and fixes;
- reusable runtime QAgent patterns;
- repeated correction signals.

## Do Not Store

- secrets, credentials, tokens, private keys;
- raw personal data;
- full user conversations when a short summary is enough;
- speculative gap guesses that were not validated.

## Vector Memory Summary Shape

```json
{
  "content_type": "qagent_learning",
  "objective_hash": "string",
  "gap_type": "frontend|backend|database|devops|testing|architecture|unknown",
  "previous_failure": "string",
  "next_instruction_summary": "string",
  "validation_result": "passed|failed|partial|not_run",
  "reuse_guidance": "string"
}
```
