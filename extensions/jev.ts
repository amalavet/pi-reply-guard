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

export interface DebugEvent {
	event: string;
	data?: string;
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
	trace?: DebugEvent[];
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
				instructions: `Does the \`reply\` from this agent adhere to the provided spec?`,
				criteria: { true: "Yes", false: "No" },
			},
		},
	};
}

async function judge(ctx: ExtensionContext, config: Config, spec: Spec, request: string, reply: string, record?: (event: string, data: unknown) => void): Promise<Verdict> {
	const [provider, ...id] = config.model.split("/");
	const classifier = ctx.modelRegistry.getModelOfType("classifier", provider, id.join("/"));
	if (!classifier) {
		record?.("classifier_unavailable", { skill: spec.name, model: config.model });
		return { name: spec.name, threshold: spec.threshold, error: `${config.model} not available`, failed: false };
	}

	const body = classifierRequest(spec, request, reply);
	record?.("classifier_request", { skill: spec.name, model: config.model, ...body });
	const result = await ctx.modelRegistry.classify(classifier, body, { signal: ctx.signal });
	record?.("classifier_response", { skill: spec.name, ...result });
	const answer = result.answers.meets;
	const probability = answer?.type === "bool" && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1
		? answer.probability : undefined;
	const error = result.stopReason !== "stop"
		? (result.errorMessage ?? result.stopReason)
		: probability === undefined ? "Classifier returned no valid probability." : undefined;
	const failed = !error && probability !== undefined && probability < spec.threshold;
	record?.("classifier_verdict", { skill: spec.name, probability, threshold: spec.threshold, error, failed });
	const raw = config.debug ? { request: body, response: result } : undefined;
	return { name: spec.name, probability, threshold: spec.threshold, error, failed, raw };
}

export async function check(ctx: ExtensionContext, config: Config, specs: Spec[], request: string, reply: string, record?: (event: string, data: unknown) => void): Promise<Check> {
	const started = Date.now();
	const verdicts = await Promise.all(specs.map((spec) => judge(ctx, config, spec, request, reply, record)));
	return { model: config.model, ms: Date.now() - started, verdicts };
}
