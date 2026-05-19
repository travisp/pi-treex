import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installTreeXNativePatches } from "./src/treex-component.js";

function getHostDistDir() {
	return dirname(realpathSync(process.argv[1]));
}

function getHostModuleUrl(relativePath) {
	return pathToFileURL(resolve(getHostDistDir(), relativePath)).href;
}

export default async function treeXExtension(pi) {
	const [{ InteractiveMode }, components] = await Promise.all([
		import(getHostModuleUrl("index.js")),
		import(getHostModuleUrl("modes/interactive/components/index.js")),
	]);

	const unpatch = installTreeXNativePatches(InteractiveMode, {
		assistantMessageComponent: components.AssistantMessageComponent,
		bashExecutionComponent: components.BashExecutionComponent,
		branchSummaryMessageComponent: components.BranchSummaryMessageComponent,
		compactionSummaryMessageComponent: components.CompactionSummaryMessageComponent,
		customMessageComponent: components.CustomMessageComponent,
		toolExecutionComponent: components.ToolExecutionComponent,
		userMessageComponent: components.UserMessageComponent,
	});

	pi.on("session_shutdown", unpatch);
}
