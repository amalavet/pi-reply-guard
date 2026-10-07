import type { CustomMessageEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH, DEFAULTS, NAME, VERDICT, loadConfig, missingSkills, promptSection, selectSpecs, type Spec } from "./config.js";
import { registerConfigCommand } from "./commands.js";
import { check, lastRequest, textOf, type Check, type Verdict } from "./jev.js";
import { registerUI, statusText } from "./ui.js";

function rewriteText(failed: Verdict[]): string {
	return [
		"Your last reply does not meet these skills:",
		...failed.map((verdict) => `- ${verdict.name}`),
		"Rewrite the reply so it meets them. Keep the same facts and conclusions. Send only the rewritten reply.",
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
	const ui = registerUI(pi, () => specs.length > 0);
	registerConfigCommand(pi);

	pi.on("before_agent_start", (event, ctx) => {
		config = loadConfig();
		specs = selectSpecs(event.systemPromptOptions.skills, config);
		ui.restore(ctx);
		const missing = missingSkills(config, specs);
		const warning = Object.keys(config.skills).length === 0
			? `no skills set. Add them to ${CONFIG_PATH}`
			: missing.length > 0 ? `skills not found: ${missing.join(", ")}` : undefined;
		if (warning && !warned) {
			warned = true;
			ctx.ui.notify(`${NAME}: ${warning}`, "warning");
		}
		if (!config.inject || specs.length === 0) return;
		event.systemPromptOptions.sections[NAME] = promptSection(specs);
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "user") rewrites = 0;
		if (event.message.role === "user" || event.message.role === "assistant") pending = undefined;
	});

	pi.on("message_end", async (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant" || message.stopReason !== "stop" || specs.length === 0) return;
		if (message.content.some((block) => block.type === "toolCall")) return;
		const reply = textOf(message.content).trim();
		if (!reply) return;

		const request = lastRequest(ctx.sessionManager.buildSessionContext().messages);
		const result = rewrites >= config.maxRewrites
			? { model: config.model, ms: 0, verdicts: [] }
			: await check(ctx, config, specs, request, reply);
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
			rewrite: config.debug && failed.length > 0 ? rewriteText(failed) : undefined,
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
		if (failed.length === 0 || event.outcome !== "completed") return { entries: [...event.entries, entry] };

		rewrites++;
		return { entries: [...event.entries, entry, rewriteRequest(rewriteText(failed))], continue: true };
	});
}
