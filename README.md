# pi-reply-guard

Checks each final reply against a list of skills. A classifier model (Jev by default) answers one yes/no question per skill. When a reply breaks a skill, the agent gets the failing skill names and rewrites the reply.

## Install

```sh
pi install git:github.com/amalavet/pi-reply-guard
```

## Configure

`~/.pi/agent/reply-guard.json`:

```json
{
  "skills": {
    "i-have-adhd": 0.7,
    "asd-ste100": 0.7
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `skills` | `{}` | Installed skill name to threshold, 0 to 1. A reply passes when the probability that it meets the skill is at or above the threshold |
| `model` | `openrouter/typesafe/jev-1.13` | Classifier model, `provider/id` |
| `maxRewrites` | `2` | Rewrites per user message |
| `inject` | `true` | Add the skill text to the system prompt |
| `debug` | `false` | Show each verdict in the chat: green ✓ on a pass, red ✗ on a fail, with errors. The model does not see it |

A debug verdict shows the probability that the reply meets each skill, against its threshold:

```
reply-guard openrouter/typesafe/jev-1.13 337ms
  ✓ asd-ste100 0.82 ≥ 0.70
  ✗ i-have-adhd 0.41 < 0.70
```

The classifier must appear in `models.getAvailableOfType("classifier")`. If it is missing or errors, the reply passes.
