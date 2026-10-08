import { createHash, randomUUID } from "node:crypto";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { NAME, SKILLS, VERDICT } from "./config.js";
import type { Check, Verdict } from "./jev.js";

function digest(text: string): string {
	return createHash("sha256").update(text.trim()).digest("hex");
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
	return JSON.stringify(verdict.raw, null, 2).split("\n").map((line) => theme.fg("dim", `    ${line}`));
}

function debugLines(result: Check, theme: Theme): string[] {
	if (result.trace) {
		return ["", "Debug trace:", ...result.trace.flatMap((entry, index) => [
			`${index + 1}. ${entry.event}`,
			...(entry.data === undefined ? [] : entry.data.split("\n").map((line) => `  ${line}`)),
		])].map((line) => theme.fg("muted", line));
	}
	const lines: string[] = [];
	if (result.failedReply) lines.push("", "Failed reply:", result.failedReply);
	if (result.rewrite) lines.push("", result.rewrite);
	return lines.map((line) => theme.fg("muted", line));
}

export function statusText(result: Check): string {
	const marks = result.verdicts.map((verdict) => `${verdict.name} ${verdict.error ? "err" : verdict.failed ? "\u2717" : "\u2713"}`);
	return `${result.model.split("/").at(-1)}: ${marks.join(" \u00b7 ")} \u00b7 ${result.ms}ms`;
}

export function registerUI(pi: ExtensionAPI, guarding: () => boolean) {
	const hidden = new Set<string>();

	pi.on("context", (event) => ({
		messages: event.messages.map((message) => message.role === "assistant" ? {
			...message,
			content: message.content.map((block) => block.type === "text"
				? { ...block, text: block.text.replace(/\n\n<!--reply-guard:[\da-f-]+-->$/, "") }
				: block),
		} : message),
	}));

	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType !== "assistant") return markdown;
		if (context.isStreaming && guarding()) return "";
		return hidden.has(digest(markdown)) ? "" : markdown;
	});

	pi.registerEntryRenderer<Check>(VERDICT, (entry, { expanded }, theme) => {
		const result = entry.data;
		const content = new Container();
		if (!result) return content;
		if (result.showVerdicts === false || (result.verdicts.length === 0 && !result.trace?.length)) {
			if (result.reply) content.addChild(new Markdown(result.reply, 1, 0, getMarkdownTheme()));
			return content;
		}

		const attempt = result.attempt !== undefined && result.attempt > 1 ? `attempt ${result.attempt} ` : "";
		const header = `${theme.fg("customMessageLabel", `[${NAME}]`)} ${theme.fg("dim", `${attempt}${result.model} ${result.ms}ms`)}`;
		const lines = result.verdicts.flatMap((verdict) => [
			`  ${verdictLine(verdict, theme)}`,
			...(expanded && !result.trace ? rawLines(verdict, theme) : []),
		]);
		const bg = result.verdicts.some((verdict) => verdict.failed) ? "toolErrorBg" : "toolSuccessBg";
		const box = new Box(1, 1, (text) => theme.bg(bg, text));
		box.addChild(new Text([header, ...lines, ...(expanded ? debugLines(result, theme) : [])].join("\n"), 0, 0));
		content.addChild(box);
		if (result.reply) {
			content.addChild(new Spacer(1));
			content.addChild(new Markdown(result.reply, 1, 0, getMarkdownTheme()));
		}
		return content;
	});

	pi.registerMessageRenderer<string[]>(SKILLS, (message, { expanded }, theme) => {
		const header = `${theme.fg("customMessageLabel", `[${NAME}]`)} ${theme.fg("dim", "preloaded skills")}`;
		const lines = (message.details ?? []).map((name) => `  ${theme.fg("success", `\u2713 ${name}`)}`);
		const body = expanded && typeof message.content === "string" ? ["", theme.fg("muted", message.content)] : [];
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text([header, ...lines, ...body].join("\n"), 0, 0));
		return box;
	});

	function restore(ctx: ExtensionContext) {
		hidden.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== VERDICT) continue;
			const result = entry.data as Check | undefined;
			for (const hash of result?.hidden ?? []) hidden.add(hash);
		}
	}

	function hide(texts: string[]): string[] {
		const hashes = texts.map(digest);
		for (const hash of hashes) hidden.add(hash);
		return hashes;
	}

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	return { hide, restore, tag: (text: string) => `${text}\n\n<!--reply-guard:${randomUUID()}-->` };
}
