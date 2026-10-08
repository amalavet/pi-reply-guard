# pi-reply-guard

[![npm](https://img.shields.io/npm/v/pi-reply-guard)](https://www.npmjs.com/package/pi-reply-guard) [![Pi package](https://img.shields.io/badge/pi-package-blue)](https://pi.dev/packages/pi-reply-guard)

Checks each agent reply against a list of skills. A classifier model (Jev by default) determines if the reply adheres to the skill on a scale of 0-1. If a reply does not adhere to the skill, the agent is prompted to edit their reply to adhere to the skill.

https://github.com/user-attachments/assets/c8c65cf3-3030-44af-88e1-03f897d86447

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
    "asd-ste100": 0.3,
    "i-have-adhd": 0.3,
    "my-reply-preferences": 0.3
  },
  "model": "openrouter/typesafe/jev-1.13",
  "maxRewrites": 2,
  "inject": false,
  "preload": true,
  "debug": false,
  "showVerdicts": true
}
```

Install the skills separately. Names must match installed skills. No skills are bundled or enabled by default. Missing or unreadable skills are skipped.

| Key | Default | Meaning |
|---|---|---|
| `skills` | `{}` | Installed skill name that replies must adhere to, with a threshold (0-1) to pass. A reply passes when the probability that it meets the skill is at or above the threshold |
| `model` | `openrouter/typesafe/jev-1.13` | Classifier model, `provider/id` |
| `maxRewrites` | `2` | How many times the agent will attempt to rewrite its response to match the spec. When this is exceeded, the final reply will be given even if it does not pass the guard. |
| `inject` | `false` | Set to `true` to add the full text of the failed skills to each rewrite request. |
| `preload` | `true` | Adds the full text of the guarded skills to the context once, at the first prompt of each session. |
| `debug` | `false` | When this is enabled, you can view the raw requests to jev, the prompts to the agent, and the failed replies. |
| `showVerdicts` | `true` | By default the guard will show a block containing a short result of the reply guard. You can set this to hide that block. |
