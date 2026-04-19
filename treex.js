import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installTreeXNativePatches } from "./src/treex-component.js";

async function loadInteractiveMode() {
	const resolvedCliPath = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
	const hostIndexPath = resolvedCliPath ? resolve(dirname(resolvedCliPath), "index.js") : undefined;
	const entry =
		hostIndexPath && existsSync(hostIndexPath) ? pathToFileURL(hostIndexPath).href : "@mariozechner/pi-coding-agent";
	const { InteractiveMode } = await import(entry);
	return InteractiveMode;
}

export default async function treeXExtension() {
	installTreeXNativePatches(await loadInteractiveMode());
}
