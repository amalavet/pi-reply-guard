import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Config {
	skills: string[];
	model: string;
	threshold: number;
	maxRewrites: number;
	inject: boolean;
	log?: string;
}

const NAME = "reply-guard";
const DEFAULTS: Config = {
	skills: [],
	model: "openrouter/typesafe/jev-1.13",
	threshold: 0.7,
	maxRewrites: 2,
	inject: true,
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
	let config = DEFAULTS;
	let specs = new Map<string, { path: string; text: string }>();
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
				specs.set(skill.name, { path: skill.filePath, text: skillBody(skill.filePath) });
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
		const verdicts = await Promise.all(
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
				return { name, path: spec.path, probability, error, failed: probability !== undefined && probability >= config.threshold };
			}),
		);
		const ms = Date.now() - started;
		const summary = verdicts
			.map((v) => `${v.name} ${v.error ? "err" : `${v.probability?.toFixed(2)} ${v.failed ? "✗" : "✓"}`}`)
			.join(" · ");
		ctx.ui.setStatus(NAME, `${config.model.split("/").at(-1)}: ${summary} · ${ms}ms`);
		if (config.log) {
			appendFileSync(
				config.log.replace(/^~(?=\/)/, process.env.HOME ?? "~"),
				`${JSON.stringify({ time: new Date().toISOString(), model: config.model, ms, rewrite: rewrites, verdicts: verdicts.map(({ path, ...v }) => v) })}\n`,
			);
		}
		const failed = verdicts.filter((verdict) => verdict.failed);
		if (failed.length === 0) return;

		rewrites++;
		ctx.ui.notify(`${NAME}: reply fails ${failed.map((f) => f.name).join(", ")}, asking for a rewrite`, "info");
		return {
			entries: [
				...event.entries,
				{
					type: "custom_message",
					customType: NAME,
					display: true,
					content: [
						"Your last reply does not meet these skills:",
						...failed.map((f) => `- ${f.name} (${f.path})`),
						"Rewrite the reply so it meets them. Keep the same facts and conclusions. Send only the rewritten reply.",
					].join("\n"),
				},
			],
			continue: true,
		};
	});
}
