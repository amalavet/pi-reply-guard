import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type Skill } from "@earendil-works/pi-coding-agent";

export const NAME = "reply-guard";
export const VERDICT = "reply-guard-verdict";
export const CONFIG_PATH = join(getAgentDir(), `${NAME}.json`);

export interface Config {
	skills: Record<string, number>;
	model: string;
	maxRewrites: number;
	inject: boolean;
	debug: boolean;
	showVerdicts: boolean;
}

export interface Spec {
	name: string;
	text: string;
	threshold: number;
}

export const DEFAULTS: Config = {
	skills: {},
	model: "openrouter/typesafe/jev-1.13",
	maxRewrites: 2,
	inject: false,
	debug: false,
	showVerdicts: true,
};

export function parseConfig(text: string): Config {
	const value = JSON.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuration must be a JSON object.");
	const config = { ...DEFAULTS, ...value };
	if (!config.skills || typeof config.skills !== "object" || Array.isArray(config.skills)) throw new Error("Skills must map names to thresholds.");
	if (Object.entries(config.skills).some(([name, threshold]) => !name.trim() || typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
		throw new Error("Each skill needs a name and a threshold from 0 to 1.");
	}
	if (typeof config.model !== "string" || !/^[^/]+\/.+/.test(config.model)) throw new Error("Model must use provider/id.");
	if (!Number.isInteger(config.maxRewrites) || config.maxRewrites < 0) throw new Error("maxRewrites must be a nonnegative integer.");
	if (typeof config.inject !== "boolean" || typeof config.debug !== "boolean" || typeof config.showVerdicts !== "boolean") {
		throw new Error("inject, debug, and showVerdicts must be booleans.");
	}
	return config;
}

export function loadConfig(): Config {
	try {
		return parseConfig(readFileSync(CONFIG_PATH, "utf8"));
	} catch {
		return DEFAULTS;
	}
}

function skillBody(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8")
			.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
			.trim();
	} catch {
		return undefined;
	}
}

export function selectSpecs(skills: Skill[], config: Config): Spec[] {
	return skills
		.filter((skill) => skill.name in config.skills)
		.map((skill) => ({ name: skill.name, text: skillBody(skill.filePath), threshold: config.skills[skill.name] }))
		.filter((spec): spec is Spec => spec.text !== undefined);
}

export function missingSkills(config: Config, specs: Spec[]): string[] {
	return Object.keys(config.skills).filter((name) => !specs.some((spec) => spec.name === name));
}

export function promptSection(specs: Spec[]): string {
	return [
		"Every reply to the user must meet the skills below. They govern reply prose, not code, commands, or file contents.",
		...specs.map((spec) => `<skill name="${spec.name}">\n${spec.text}\n</skill>`),
	].join("\n\n");
}
