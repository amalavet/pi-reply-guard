import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getAgentDir,
	type AgentBeforeSettleEvent,
	type CustomEntryDraft,
	type CustomMessageEntryDraft,
	type ExtensionAPI,
	type ExtensionContext,
	type Skill,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const NAME = "reply-guard";
const VERDICT = "reply-guard-verdict";
const CONFIG_PATH = join(getAgentDir(), `${NAME}.json`);

interface Config {
	skills: Record<string, number>;
	model: string;
	maxRewrites: number;
	inject: boolean;
	debug: boolean;
}

interface Spec {
	name: string;
	text: string;
	threshold: number;
}

interface Verdict {
	name: string;
	probability?: number;
	threshold: number;
	error?: string;
	failed: boolean;
	raw?: Raw;
}

interface Raw {
	request: unknown;
	response: unknown;
}

interface Check {
	model: string;
	ms: number;
	verdicts: Verdict[];
}

type Messages = AgentBeforeSettleEvent["context"]["contextMessages"];

const DEFAULTS: Config = {
	skills: {},
	model: "openrouter/typesafe/jev-1.13",
	maxRewrites: 2,
	inject: true,
	debug: false,
};

function loadConfig(): Config {
	try {
		return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
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

function selectSpecs(skills: Skill[], config: Config): Spec[] {
	return skills
		.filter((skill) => skill.name in config.skills)
		.map((skill) => ({ name: skill.name, text: skillBody(skill.filePath), threshold: config.skills[skill.name] }));
}

function missingSkills(config: Config, specs: Spec[]): string[] {
	return Object.keys(config.skills).filter((name) => !specs.some((spec) => spec.name === name));
}

function promptSection(specs: Spec[]): string {
	return [
		"Every reply to the user must meet the skills below. They govern reply prose, not code, commands, or file contents.",
		...specs.map((spec) => `<skill name="${spec.name}">\n${spec.text}\n</skill>`),
	].join("\n\n");
}

function finalReply(messages: Messages): string | undefined {
	const reply = messages.at(-1);
	if (reply?.role !== "assistant" || reply.stopReason !== "stop") return undefined;
	return textOf(reply.content).trim() || undefined;
}

function lastRequest(messages: Messages): string {
	return textOf(messages.findLast((message) => message.role === "user")?.content).slice(0, 4000);
}

function classifierRequest(spec: Spec, request: string, reply: string) {
	return {
		state: { spec: spec.text, request, reply: reply.slice(0, 16000) },
		questions: {
			meets: {
				type: "bool" as const,
				instructions: `Does \`reply\` meet every rule in \`spec\`, the "${spec.name}" skill? Apply the exceptions the spec allows for \`request\`. Judge only the reply prose. Code, commands, and quoted text are exempt.`,
				criteria: { true: "Meets the spec", false: "Breaks the spec" },
			},
		},
	};
}

async function judge(ctx: ExtensionContext, config: Config, spec: Spec, request: string, reply: string): Promise<Verdict> {
	const [provider, ...id] = config.model.split("/");
	const classifier = ctx.modelRegistry.getModelOfType("classifier", provider, id.join("/"));
	if (!classifier) return { name: spec.name, threshold: spec.threshold, error: `${config.model} not available`, failed: false };

	const body = classifierRequest(spec, request, reply);
	const result = await ctx.modelRegistry.classify(classifier, body, { signal: ctx.signal });
	const answer = result.answers.meets;
	const probability = answer?.type === "bool" ? answer.probability : undefined;
	const error = result.stopReason === "stop" ? undefined : (result.errorMessage ?? result.stopReason);
	const failed = probability !== undefined && probability < spec.threshold;
	const raw = config.debug ? { request: body, response: result } : undefined;
	return { name: spec.name, probability, threshold: spec.threshold, error, failed, raw };
}

async function check(ctx: ExtensionContext, config: Config, specs: Spec[], messages: Messages): Promise<Check | undefined> {
	const reply = finalReply(messages);
	if (!reply) return undefined;
	const request = lastRequest(messages);
	const started = Date.now();
	const verdicts = await Promise.all(specs.map((spec) => judge(ctx, config, spec, request, reply)));
	return { model: config.model, ms: Date.now() - started, verdicts };
}

function verdictEntry(result: Check): CustomEntryDraft {
	return { type: "custom", customType: VERDICT, data: result };
}

function rewriteRequest(failed: Verdict[], display: boolean): CustomMessageEntryDraft {
	return {
		type: "custom_message",
		customType: NAME,
		display,
		content: [
			"Your last reply does not meet these skills:",
			...failed.map((verdict) => `- ${verdict.name}`),
			"Rewrite the reply so it meets them. Keep the same facts and conclusions. Send only the rewritten reply.",
		].join("\n"),
	};
}

function verdictLine(verdict: Verdict, theme: Theme): string {
	if (verdict.error) return theme.fg("warning", `! ${verdict.name}: ${verdict.error}`);
	const mark = verdict.failed ? "\u2717" : "\u2713";
	const compare = verdict.failed ? "<" : "\u2265";
	const text = `${mark} ${verdict.name} ${verdict.probability?.toFixed(2)} ${compare} ${verdict.threshold.toFixed(2)}`;
	return theme.fg(verdict.failed ? "error" : "success", text);
}

function rawLines(verdict: Verdict, theme: Theme): string[] {
	if (!verdict.raw) return [];
	const json = JSON.stringify(verdict.raw, null, 2).split("\n");
	return json.map((line) => theme.fg("dim", `    ${line}`));
}

function statusText(result: Check): string {
	const marks = result.verdicts.map((verdict) => `${verdict.name} ${verdict.error ? "err" : verdict.failed ? "\u2717" : "\u2713"}`);
	return `${result.model.split("/").at(-1)}: ${marks.join(" \u00b7 ")} \u00b7 ${result.ms}ms`;
}

export default function (pi: ExtensionAPI) {
	let config = DEFAULTS;
	let specs: Spec[] = [];
	let rewrites = 0;
	let warned = false;

	const warnOnce = (ctx: ExtensionContext, message: string) => {
		if (warned) return;
		warned = true;
		ctx.ui.notify(`${NAME}: ${message}`, "warning");
	};

	pi.registerEntryRenderer<Check>(VERDICT, (entry, { expanded }, theme) => {
		if (!entry.data) return new Text("", 0, 0);
		const header = theme.fg("dim", `${NAME} ${entry.data.model} ${entry.data.ms}ms`);
		const lines = entry.data.verdicts.flatMap((verdict) => [
			`  ${verdictLine(verdict, theme)}`,
			...(expanded ? rawLines(verdict, theme) : []),
		]);
		return new Text([header, ...lines].join("\n"), 1, 0);
	});

	pi.on("input", () => {
		rewrites = 0;
	});

	pi.on("before_agent_start", (event, ctx) => {
		config = loadConfig();
		specs = selectSpecs(event.systemPromptOptions.skills, config);
		const missing = missingSkills(config, specs);

		if (Object.keys(config.skills).length === 0) warnOnce(ctx, `no skills set. Add them to ${CONFIG_PATH}`);
		if (missing.length > 0) warnOnce(ctx, `skills not found: ${missing.join(", ")}`);
		if (!config.inject || specs.length === 0) return;

		event.systemPromptOptions.sections[NAME] = promptSection(specs);
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed") return;
		if (specs.length === 0 || rewrites >= config.maxRewrites) return;

		const result = await check(ctx, config, specs, event.context.contextMessages);
		if (!result) return;

		ctx.ui.setStatus(NAME, statusText(result));
		const entries = [...event.entries, verdictEntry(result)];
		const failed = result.verdicts.filter((verdict) => verdict.failed);
		if (failed.length === 0) return { entries };

		rewrites++;
		return { entries: [...entries, rewriteRequest(failed, config.debug)], continue: true };
	});
}
