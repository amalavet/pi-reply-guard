# pi-reply-guard

Checks each final reply against a list of skills. A classifier model (Jev by default) answers one yes/no question per skill. When a reply breaks a skill, the agent gets the failing skill names and paths and rewrites the reply.

## Install

```sh
pi install git:github.com/amalavet/pi-reply-guard
```

## Configure

`~/.pi/agent/reply-guard.json`:

```json
{
  "skills": ["i-have-adhd", "asd-ste100"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `skills` | `[]` | Names of installed skills to enforce |
| `model` | `openrouter/typesafe/jev-1.13` | Classifier model, `provider/id` |
| `threshold` | `0.7` | Violation probability that fails a reply |
| `maxRewrites` | `2` | Rewrites per user message |
| `inject` | `true` | Add the skill text to the system prompt |

The classifier must appear in `models.getAvailableOfType("classifier")`. If it is missing or errors, the reply passes.
