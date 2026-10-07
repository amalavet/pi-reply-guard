# pi-reply-guard

Checks each agent reply against a list of skills. A classifier model (Jev by default) determines if the reply adheres to the skill on a scale of 0-1. If a reply does not adhere to the skill, the agent is prompted to edit their reply to adhere to the skill.

## Demo

https://github.com/user-attachments/assets/1285097b-e628-4b07-b417-2b4db6b02b63

## Install

```sh
pi install npm:pi-reply-guard
```

Or install from GitHub:

```sh
pi install git:github.com/amalavet/pi-reply-guard
```

## Configure

Run `/reply-guard` in Pi to open the settings menu. Select a setting to change it, or choose “Edit JSON” to edit the full configuration. Each change saves to `~/.pi/agent/reply-guard.json` and applies to the next reply:

```json
{
  "skills": {
    "i-have-adhd": 0.3,
    "ste-plain-writing": 0.5
  },
  "model": "openrouter/typesafe/jev-1.13",
  "maxRewrites": 2,
  "inject": false,
  "debug": false,
  "showVerdicts": true
}
```

Install the skills separately. Names must match installed skills. No skills are bundled or enabled by default. Missing or unreadable skills are skipped.

| Key | Default | Meaning |
|---|---|---|
| `skills` | `{}` | Installed skill name that replies must adhere to, with a threshold (0-1) to pass. A reply passes when the probability that it meets the skill is at or above the threshold |
| `model` | `openrouter/typesafe/jev-1.13` | Classifier model, `provider/id` |
| `maxRewrites` | `2` | How many time the agent will attempt to rewrite it's response to match the spec. When this is exceeded, the final reply will be given even if it does not pass the guard. |
| `inject` | `false` | Set to `true` to inject the entire skill text into the context every time the guard triggers. If this is `false` the guard will only prompt with the name of the skill.|
| `debug` | `false` | When this is enabled, you can view the raw requests to jev, the prompts to the agent, and the failed replies. |
| `showVerdicts` | `true` | By default the guard will show a block containing a short result of the reply guard. You can set this to hide that block. |
