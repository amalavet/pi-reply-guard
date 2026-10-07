import type { AgentBeforeSettleEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Config, Spec } from "./config.js";

export interface Verdict {
	name: string;
	probability?: number;
	threshold: number;
	error?: string;
	failed: boolean;
	raw?: { request: unknown; response: unknown };
}

export interface Check {
	attempt?: number;
	showVerdicts?: boolean;
	model: string;
	ms: number;
	verdicts: Verdict[];
	rewrite?: string;
	hidden?: string[];
	reply?: string;
	failedReply?: string;
}

type Messages = AgentBeforeSettleEvent["context"]["contextMessages"];

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((block) => (block?.type === "text" ? [block.text] : [])).join("\n");
}

export function lastRequest(messages: Messages): string {
	return textOf(messages.findLast((message) => message.role === "user")?.content).slice(0, 4000);
}

function classifierRequest(spec: Spec, request: string, reply: string) {
	return {
		state: { spec: spec.text, request, reply: reply.slice(0, 16000) },
		questions: {
			meets: {
				type: "bool" as const,
				instructions: `Does \`reply\` meet every rule in \`spec\`, the "${spec.name}" skill, that applies to a chat reply? Apply the exceptions the spec allows for \`request\`. Judge only the reply prose. Code, commands, and quoted text are exempt.`,
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
	const probability = answer?.type === "bool" && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1
		? answer.probability : undefined;
	const error = result.stopReason !== "stop"
		? (result.errorMessage ?? result.stopReason)
		: probability === undefined ? "Classifier returned no valid probability." : undefined;
	const failed = !error && probability !== undefined && probability < spec.threshold;
	const raw = config.debug ? { request: body, response: result } : undefined;
	return { name: spec.name, probability, threshold: spec.threshold, error, failed, raw };
}

export async function check(ctx: ExtensionContext, config: Config, specs: Spec[], request: string, reply: string): Promise<Check> {
	const started = Date.now();
	const verdicts = await Promise.all(specs.map((spec) => judge(ctx, config, spec, request, reply)));
	return { model: config.model, ms: Date.now() - started, verdicts };
}
