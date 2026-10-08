import type { CustomMessageEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH, DEFAULTS, NAME, SKILLS, VERDICT, loadConfig, missingSkills, promptSection, selectSpecs, type Spec } from "./config.js";
import { registerConfigCommand } from "./commands.js";
import { check, lastRequest, textOf, type Check, type DebugEvent, type Verdict } from "./jev.js";
import { registerUI, statusText } from "./ui.js";

function rewriteText(failed: Verdict[], skills: Spec[] = []): string {
	return [
		"Your last reply was hidden from the end-user because it does not adhere to the following skills:",
		...failed.map((verdict) => `- ${verdict.name}`),
		"Rewrite the reply in a manner that adheres to these skills. If you have not already read them in full, please do before proceeding.",
		...(skills.length > 0 ? ["", promptSection(skills)] : []),
	].join("\n");
}

function rewriteRequest(text: string): CustomMessageEntryDraft {
	return { type: "custom_message", customType: NAME, display: false, content: text };
}

export default function (pi: ExtensionAPI) {
	let config = DEFAULTS;
	let specs: Spec[] = [];
	let rewrites = 0;
	let warned = false;
	let pending: Check | undefined;
	let trace: DebugEvent[] = [];

	function record(event: string, data?: unknown) {
		if (config.debug) trace.push({ event, data: typeof data === "string" ? data : JSON.stringify(data, null, 2) });
	}

	const ui = registerUI(pi, () => specs.length > 0);
	registerConfigCommand(pi);

	pi.on("before_agent_start", (event, ctx) => {
		config = loadConfig();
		trace = [];
		specs = selectSpecs(event.systemPromptOptions.skills, config);
		ui.restore(ctx);
		const missing = missingSkills(config, specs);
		record("before_agent_start", { prompt: event.prompt, config, selectedSkills: specs.map((spec) => spec.name), missingSkills: missing });
		const warning = Object.keys(config.skills).length === 0
			? `no skills set. Add them to ${CONFIG_PATH}`
			: missing.length > 0 ? `skills not found: ${missing.join(", ")}` : undefined;
		if (warning && !warned) {
			warned = true;
			ctx.ui.notify(`${NAME}: ${warning}`, "warning");
		}
		const loaded = ctx.sessionManager.getBranch().some((entry) => entry.type === "custom_message" && entry.customType === SKILLS);
		if (!config.preload || specs.length === 0 || loaded) return;
		const content = promptSection(specs);
		record("skill_preload", content);
		return { message: { customType: SKILLS, content, display: true, details: specs.map((spec) => spec.name) } };
	});

	pi.on("agent_start", () => record("agent_start"));
	pi.on("turn_start", (event) => record("turn_start", { turnIndex: event.turnIndex }));
	pi.on("before_provider_request", (event) => record("before_provider_request", event.payload));
	pi.on("tool_execution_start", (event) => record("tool_execution_start", event));
	pi.on("tool_execution_end", (event) => record("tool_execution_end", event));
	pi.on("turn_end", (event) => record("turn_end", { turnIndex: event.turnIndex, outcome: event.outcome }));
	pi.on("agent_end", () => record("agent_end"));

	pi.on("message_start", (event) => {
		record("message_start", { role: event.message.role });
		if (event.message.role === "user") rewrites = 0;
		if (event.message.role === "user" || event.message.role === "assistant") pending = undefined;
	});

	pi.on("message_end", async (event, ctx) => {
		const message = event.message;
		record("message_end", { role: message.role, text: textOf("content" in message ? message.content : undefined), stopReason: message.role === "assistant" ? message.stopReason : undefined });
		if (message.role !== "assistant" || message.stopReason !== "stop" || specs.length === 0) return;
		if (message.content.some((block) => block.type === "toolCall")) return;
		const reply = textOf(message.content).trim();
		if (!reply) return;

		const request = lastRequest(ctx.sessionManager.buildSessionContext().messages);
		record(rewrites >= config.maxRewrites ? "check_skipped" : "check_started", { attempt: rewrites + 1, maxRewrites: config.maxRewrites, request, reply });
		const result = rewrites >= config.maxRewrites
			? { model: config.model, ms: 0, verdicts: [] }
			: await check(ctx, config, specs, request, reply, config.debug ? record : undefined);
		const failed = result.verdicts.filter((verdict) => verdict.failed);
		const content = message.content.map((block) => block.type === "text" ? { ...block, text: ui.tag(block.text) } : block);
		const hidden = ui.hide(content.flatMap((block) => block.type === "text" ? [block.text] : []));
		pending = {
			...result,
			attempt: rewrites + 1,
			showVerdicts: config.showVerdicts,
			hidden,
			reply: failed.length === 0 ? reply : undefined,
			failedReply: config.debug && failed.length > 0 ? reply : undefined,
			rewrite: config.debug && failed.length > 0 ? rewriteText(failed, config.inject ? specs.filter((spec) => failed.some((verdict) => verdict.name === spec.name)) : []) : undefined,
		};
		return { message: { ...message, content } };
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		const result = pending;
		pending = undefined;
		if (!result) return;
		ctx.ui.setStatus(NAME, result.showVerdicts !== false && result.verdicts.length > 0 ? statusText(result) : undefined);
		const entry = { type: "custom" as const, customType: VERDICT, data: result };
		const failed = result.verdicts.filter((verdict) => verdict.failed);
		record("agent_before_settle", { outcome: event.outcome, attempt: result.attempt, failedSkills: failed.map((verdict) => verdict.name) });
		if (failed.length === 0 || event.outcome !== "completed") {
			record("reply_released", { checked: result.verdicts.length > 0, displayed: result.reply !== undefined });
			result.trace = config.debug ? trace.splice(0) : undefined;
			return { entries: [...event.entries, entry] };
		}

		rewrites++;
		const rewrite = rewriteText(failed, config.inject ? specs.filter((spec) => failed.some((verdict) => verdict.name === spec.name)) : []);
		record("rewrite_requested", { nextAttempt: rewrites + 1, prompt: rewrite });
		result.trace = config.debug ? trace.splice(0) : undefined;
		return { entries: [...event.entries, entry, rewriteRequest(rewrite)], continue: true };
	});
}
