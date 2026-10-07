import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface Config {
	skills: string[];
	model: string;
	threshold: number;
	maxRewrites: number;
	inject: boolean;
	debug: boolean;
}

const NAME = "reply-guard";
const VERDICT = "reply-guard-verdict";

interface Verdict {
	name: string;
	probability?: number;
	error?: string;
	failed: boolean;
}
const DEFAULTS: Config = {
	skills: [],
	model: "openrouter/typesafe/jev-1.13",
	threshold: 0.7,
	maxRewrites: 2,
	inject: true,
	debug: false,
};

function loadConfig(): Config {
	try {
		return { ...DEFAULTS, ...JSON.parse(readFileSync(join(getAgentDir(), `${NAME}.json`), "utf8")) };
	} catch {
		return DEFAULTS;
	}
}

function skillBody(path: string): string {
	return readFileSync(path, "utf8")
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
		.trim();
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((block) => (block?.type === "text" ? [block.text] : [])).join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer<{ model: string; ms: number; verdicts: Verdict[] }>(VERDICT, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return new Text("", 0, 0);
		const parts = data.verdicts.map((v) =>
			v.error
				? theme.fg("warning", `! ${v.name}: ${v.error}`)
				: theme.fg(v.failed ? "error" : "success", `${v.failed ? "\u2717" : "\u2713"} ${v.name} ${v.probability?.toFixed(2)}`),
		);
		return new Text([theme.fg("dim", `${NAME} ${data.model} ${data.ms}ms`), ...parts.map((part) => `  ${part}`)].join("\n"), 1, 0);
	});

	let config = DEFAULTS;
	let specs = new Map<string, { text: string }>();
	let rewrites = 0;
	let warned = false;

	pi.on("input", () => {
		rewrites = 0;
	});

	pi.on("before_agent_start", (event, ctx) => {
		config = loadConfig();
		specs = new Map();
		for (const skill of event.systemPromptOptions.skills) {
			if (config.skills.includes(skill.name)) {
				specs.set(skill.name, { text: skillBody(skill.filePath) });
			}
		}
		const missing = config.skills.filter((name) => !specs.has(name));
		if (missing.length > 0 && !warned) {
			warned = true;
			ctx.ui.notify(`${NAME}: skills not found: ${missing.join(", ")}`, "warning");
		}
		if (config.inject && specs.size > 0) {
			event.systemPromptOptions.sections[NAME] = [
				"Every reply to the user must meet the skills below. They govern reply prose, not code, commands, or file contents.",
				...[...specs].map(([name, spec]) => `<skill name="${name}">\n${spec.text}\n</skill>`),
			].join("\n\n");
		}
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed" || specs.size === 0 || rewrites >= config.maxRewrites) return;
		const messages = event.context.contextMessages;
		const reply = messages.at(-1);
		if (reply?.role !== "assistant" || reply.stopReason !== "stop") return;
		const draft = textOf(reply.content).trim();
		if (!draft) return;

		const [provider, ...id] = config.model.split("/");
		const model = ctx.modelRegistry.getModelOfType("classifier", provider, id.join("/"));
		if (!model) {
			if (!warned) ctx.ui.notify(`${NAME}: classifier ${config.model} not available`, "warning");
			warned = true;
			return;
		}

		const request = textOf(messages.findLast((message) => message.role === "user")?.content).slice(0, 4000);
		const started = Date.now();
		const verdicts: Verdict[] = await Promise.all(
			[...specs].map(async ([name, spec]) => {
				const result = await ctx.modelRegistry.classify(
					model,
					{
						state: { spec: spec.text, request, reply: draft.slice(0, 16000) },
						questions: {
							violates: {
								type: "bool",
								instructions: `Does \`reply\` break a rule in \`spec\`, the "${name}" skill? Apply the exceptions the spec allows for \`request\`. Judge only the reply prose. Code, commands, and quoted text are exempt.`,
								criteria: { true: "Breaks the spec", false: "Meets the spec" },
							},
						},
					},
					{ signal: ctx.signal },
				);
				const answer = result.answers.violates;
				const probability = answer?.type === "bool" ? answer.probability : undefined;
				const error = result.stopReason === "stop" ? undefined : (result.errorMessage ?? result.stopReason);
				return { name, probability, error, failed: probability !== undefined && probability >= config.threshold };
			}),
		);
		const ms = Date.now() - started;
		const summary = verdicts
			.map((v) => `${v.name} ${v.error ? "err" : `${v.probability?.toFixed(2)} ${v.failed ? "✗" : "✓"}`}`)
			.join(" · ");
		ctx.ui.setStatus(NAME, `${config.model.split("/").at(-1)}: ${summary} · ${ms}ms`);
		const entries = config.debug
			? [
					...event.entries,
					{ type: "custom" as const, customType: VERDICT, data: { model: config.model, ms, verdicts } },
				]
			: event.entries;
		const failed = verdicts.filter((verdict) => verdict.failed);
		if (failed.length === 0) return config.debug ? { entries } : undefined;

		rewrites++;
		return {
			entries: [
				...entries,
				{
					type: "custom_message",
					customType: NAME,
					display: false,
					content: [
						"Your last reply does not meet these skills:",
						...failed.map((f) => `- ${f.name}`),
						"Rewrite the reply so it meets them. Keep the same facts and conclusions. Send only the rewritten reply.",
					].join("\n"),
				},
			],
			continue: true,
		};
	});
}
