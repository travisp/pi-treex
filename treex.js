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

export default async function treeXExtension() {
	const [{ InteractiveMode }, { ToolExecutionComponent }] = await Promise.all([
		import(getHostModuleUrl("index.js")),
		import(getHostModuleUrl("modes/interactive/components/tool-execution.js")),
	]);

	installTreeXNativePatches(InteractiveMode, ToolExecutionComponent);
}
