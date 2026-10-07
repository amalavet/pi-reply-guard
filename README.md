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
| `debug` | `false` | Show each verdict, with errors, as a notification in the session |

The status bar shows the last verdict: `jev-1.13: i-have-adhd 0.12 ✓ · asd-ste100 0.81 ✗ · 310ms`. The number is the probability that the reply breaks the skill.

The classifier must appear in `models.getAvailableOfType("classifier")`. If it is missing or errors, the reply passes.
