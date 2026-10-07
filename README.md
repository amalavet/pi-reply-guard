# pi-reply-guard

Checks each final reply against a list of skills. A classifier model (Jev by default) answers one yes/no question per skill. When a reply breaks a skill, the agent gets the failing skill names and rewrites the reply.

## Install

```sh
pi install npm:pi-reply-guard
```

Or install from GitHub:

```sh
pi install git:github.com/amalavet/pi-reply-guard
```

Developed against Pi 1.0.4. Requires a Pi version with classifier models, `agent_before_settle`, custom entry renderers, and `registerMarkdownTransformer`. Authenticate with the classifier provider before use. The default model uses OpenRouter.

## Configure

Run `/reply-guard` in Pi to open the settings menu. Select a setting to change it, or choose “Edit JSON” to edit the full configuration. Each change saves to `~/.pi/agent/reply-guard.json` and applies to the next reply:

```json
{
  "skills": {
    "i-have-adhd": 0.3,
    "ste-plain-writing": 0.5
  }
}
```

Install the skills separately. Names must match installed skills. No skills are bundled or enabled by default. Missing or unreadable skills are skipped.

| Key | Default | Meaning |
|---|---|---|
| `skills` | `{}` | Installed skill name to threshold, 0 to 1. A reply passes when the probability that it meets the skill is at or above the threshold |
| `model` | `openrouter/typesafe/jev-1.13` | Classifier model, `provider/id` |
| `maxRewrites` | `2` | Rewrites per user message |
| `inject` | `true` | Add full skill text to one system-prompt section. Set `false` to leave it out of the agent prompt. Classifier checks still use the full text |
| `debug` | `false` | Store failed drafts, rewrite requests, and raw classifier inputs and outputs in verdict entries. Press `ctrl+o` to view them |
| `showVerdicts` | `true` | Show verdict blocks and status. Set `false` to hide them without disabling checks or rewrites |

In the terminal UI, reply text stays hidden while the classifier checks it. Accepted replies appear below their verdicts. Failed drafts stay hidden unless debug mode is enabled and you press `ctrl+o`. Original reply text remains in session history and model context. Session messages include a unique display marker that is removed from model context.

Each check adds a verdict to the chat. The model does not see the verdict entry. The verdict shows the probability that the reply meets each skill, against its threshold:

```
reply-guard attempt 2 openrouter/typesafe/jev-1.13 337ms
  ✓ ste-plain-writing 0.82 ≥ 0.50
  ✗ i-have-adhd 0.21 < 0.30
```

## Privacy and limits

Each check sends the full selected skill text, up to 4,000 characters of the latest user message, and up to 16,000 characters of the reply to the classifier provider. Debug mode also stores classifier inputs and outputs in the session.

Scores are model estimates, not guarantees. Adjust thresholds for your skills and replies.

After `maxRewrites`, the extension displays the last rewrite without another check. Reply hiding applies to the terminal UI, not JSON, RPC, or print output. Each skill adds a classifier request per check, with provider latency and cost.

The classifier must appear in `models.getAvailableOfType("classifier")`. An unavailable classifier does not block the reply. Reported classifier errors appear in the verdict. Missing or invalid classifier probabilities appear as errors and do not trigger rewrites.

## Local development

```sh
git clone https://github.com/amalavet/pi-reply-guard.git
cd pi-reply-guard
npm install
pi install .
```

Local dependencies let your editor resolve Pi's types. Pi supplies the host packages at runtime. Run `/reload` in Pi after editing the extension.

## Publishing

Publish the package to npm with `npm publish`. The `pi-package` keyword makes it eligible for the [Pi package catalog](https://pi.dev/packages). GitHub publication alone does not add it to the npm catalog.

The package includes its TypeScript entry point and helper modules. Pi loads them without a build. Catalog image and video previews are optional.

## License

[MIT](LICENSE).
