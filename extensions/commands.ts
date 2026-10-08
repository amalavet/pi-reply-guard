import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH, NAME, loadConfig, parseConfig } from "./config.js";

export function registerConfigCommand(pi: ExtensionAPI) {
	pi.registerCommand(NAME, {
		description: "Edit reply guard skills, thresholds, model, and display settings",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			let config = loadConfig();
			while (true) {
				const options = [
					`Skills and thresholds (${Object.keys(config.skills).length})`,
					`Classifier model: ${config.model}`,
					`Maximum rewrites: ${config.maxRewrites}`,
					`Show verdicts: ${config.showVerdicts ? "on" : "off"}`,
					`Inject skill text: ${config.inject ? "on" : "off"}`,
					`Preload skills: ${config.preload ? "on" : "off"}`,
					`Debug: ${config.debug ? "on" : "off"}`,
					"Edit JSON",
					"Done",
				];
				const selected = await ctx.ui.select("Reply guard settings", options);
				if (selected === undefined || selected === "Done") return;
				const next = { ...config, skills: { ...config.skills } };
				try {
					switch (options.indexOf(selected)) {
						case 0: {
							const names = Object.keys(config.skills);
							const items = names.map((name) => `${name}: ${config.skills[name]}`);
							const skill = await ctx.ui.select("Skills and thresholds", [...items, "Add skill"]);
							if (skill === undefined) continue;
							const name = skill === "Add skill"
								? (await ctx.ui.input("Installed skill name"))?.trim()
								: names[items.indexOf(skill)];
							if (!name) continue;
							const threshold = await ctx.ui.input(
								`Threshold for ${name} (0–1, leave blank to disable)`,
								String(config.skills[name] ?? 0.5),
							);
							if (threshold === undefined) continue;
							if (threshold.trim() === "") delete next.skills[name];
							else next.skills[name] = Number(threshold);
							break;
						}
						case 1: {
							const model = await ctx.ui.input("Classifier model (provider/id)", config.model);
							if (model === undefined) continue;
							next.model = model.trim();
							break;
						}
						case 2: {
							const count = await ctx.ui.input("Maximum rewrites", String(config.maxRewrites));
							if (count === undefined) continue;
							next.maxRewrites = count.trim() === "" ? NaN : Number(count);
							break;
						}
						case 3: next.showVerdicts = !config.showVerdicts; break;
						case 4: next.inject = !config.inject; break;
						case 5: next.preload = !config.preload; break;
						case 6: next.debug = !config.debug; break;
						case 7: {
							const text = await ctx.ui.editor("Reply guard configuration", JSON.stringify(config, null, 2));
							if (text === undefined) continue;
							Object.assign(next, parseConfig(text));
							break;
						}
					}
					const validated = parseConfig(JSON.stringify(next));
					writeFileSync(CONFIG_PATH, `${JSON.stringify(validated, null, 2)}\n`);
					config = validated;
					ctx.ui.notify("Reply guard settings saved. They apply to the next reply.", "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
			}
		},
	});
}
