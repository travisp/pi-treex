import * as host from "@earendil-works/pi-coding-agent";

import { installTreeXNativePatches } from "./src/treex-component.js";

export default function treeXExtension(pi) {
	// Pi's loader supplies the active runtime, including in standalone binaries.
	const unpatch = installTreeXNativePatches(host.InteractiveMode, {
		assistantMessageComponent: host.AssistantMessageComponent,
		bashExecutionComponent: host.BashExecutionComponent,
		branchSummaryMessageComponent: host.BranchSummaryMessageComponent,
		compactionSummaryMessageComponent: host.CompactionSummaryMessageComponent,
		customMessageComponent: host.CustomMessageComponent,
		toolExecutionComponent: host.ToolExecutionComponent,
		userMessageComponent: host.UserMessageComponent,
	});

	pi.on("session_shutdown", unpatch);
}
