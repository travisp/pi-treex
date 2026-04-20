import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const DETAIL_BODY_LINES = 3;
const THEME_KEY = Symbol.for("@mariozechner/pi-coding-agent:theme");
const PATCHED_SHOW_SELECTOR = Symbol.for("pi-treex:show-selector-patched");

function getTheme() {
	return globalThis[THEME_KEY];
}

function normalizeDetail(text) {
	return String(text ?? "")
		.replace(/\r/g, "")
		.replace(/\t/g, "    ")
		.trim();
}

function hasVisibleText(line) {
	return visibleWidth(String(line ?? "").trim()) > 0;
}

function safeJson(value, spacing = 0) {
	try {
		return JSON.stringify(value, null, spacing);
	} catch {
		return "[unserializable]";
	}
}

function formatRelativeTime(timestamp) {
	const then = new Date(timestamp).getTime();
	if (!Number.isFinite(then)) return "UNKNOWN TIME";

	const diffMinutes = Math.floor(Math.max(0, Date.now() - then) / 60000);
	if (diffMinutes < 1) return "JUST NOW";
	if (diffMinutes < 60) return `${diffMinutes} MIN AGO`;

	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours} HR AGO`;

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays} DAY AGO`;

	const diffMonths = Math.floor(diffDays / 30);
	if (diffMonths < 12) return `${diffMonths} MO AGO`;

	return `${Math.floor(diffMonths / 12)} YR AGO`;
}

function fitLine(line, width) {
	const truncated = truncateToWidth(line, width);
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function getDisplayIndent(treeList, flatNode) {
	return treeList.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;
}

function getDisplayDepth(treeList, flatNode) {
	return getDisplayIndent(treeList, flatNode) + 1;
}

function getVisibleWindow(treeList) {
	if (treeList.filteredNodes.length === 0) {
		return { startIndex: 0, endIndex: 0 };
	}

	const startIndex = Math.max(
		0,
		Math.min(
			treeList.selectedIndex - Math.floor(treeList.maxVisibleLines / 2),
			treeList.filteredNodes.length - treeList.maxVisibleLines,
		),
	);

	return {
		startIndex,
		endIndex: Math.min(startIndex + treeList.maxVisibleLines, treeList.filteredNodes.length),
	};
}

function getStickyLeftState(treeList) {
	const { startIndex, endIndex } = getVisibleWindow(treeList);
	if (startIndex === endIndex) {
		return {
			startIndex,
			endIndex,
			stickyLeftShift: 0,
			stickyLeftDepth: null,
		};
	}

	let minVisibleDisplayIndent = Number.POSITIVE_INFINITY;
	for (let index = startIndex; index < endIndex; index++) {
		const flatNode = treeList.filteredNodes[index];
		minVisibleDisplayIndent = Math.min(minVisibleDisplayIndent, getDisplayIndent(treeList, flatNode));
	}

	const stickyLeftShift = Math.max(0, minVisibleDisplayIndent - 1);

	return {
		startIndex,
		endIndex,
		stickyLeftShift,
		stickyLeftDepth: stickyLeftShift > 0 ? minVisibleDisplayIndent + 1 : null,
	};
}

function shiftGutters(gutters, stickyLeftShift) {
	if (stickyLeftShift === 0) return gutters;
	return gutters
		.map((gutter) => ({ ...gutter, position: gutter.position - stickyLeftShift }))
		.filter((gutter) => gutter.position >= 0);
}

function patchTreeListRender(treeList) {
	if (treeList.__treexStickyLeftPatched) return;

	const originalRender = treeList.render.bind(treeList);
	treeList.__treexStickyLeftPatched = true;

	treeList.render = function renderStickyLeft(width) {
		const { startIndex, endIndex, stickyLeftShift } = getStickyLeftState(this);
		if (stickyLeftShift === 0) {
			return originalRender(width);
		}

		const originalNodes = [];

		for (let index = startIndex; index < endIndex; index++) {
			const flatNode = this.filteredNodes[index];
			const shiftedIndent = Math.max(0, getDisplayIndent(this, flatNode) - stickyLeftShift);

			originalNodes.push({
				flatNode,
				indent: flatNode.indent,
				gutters: flatNode.gutters,
			});

			flatNode.indent = this.multipleRoots ? shiftedIndent + 1 : shiftedIndent;
			flatNode.gutters = shiftGutters(flatNode.gutters, stickyLeftShift);
		}

		try {
			return originalRender(width);
		} finally {
			for (const originalNode of originalNodes) {
				originalNode.flatNode.indent = originalNode.indent;
				originalNode.flatNode.gutters = originalNode.gutters;
			}
		}
	};
}

function formatToolCallVerbose(name, args) {
	const json = safeJson(args, 2);
	return json ? `${name}\n${json}` : name;
}

function extractDetailContent(treeList, content, options = {}) {
	const { includeToolCalls = false, verboseToolCalls = false } = options;

	if (typeof content === "string") {
		return normalizeDetail(content);
	}

	if (!Array.isArray(content)) return "";

	const parts = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;

		if (block.type === "text") {
			parts.push(normalizeDetail(block.text));
			continue;
		}

		if (block.type === "toolCall" && includeToolCalls) {
			parts.push(
				verboseToolCalls
					? formatToolCallVerbose(block.name, block.arguments)
					: treeList.formatToolCall(block.name, block.arguments),
			);
			continue;
		}

		if (block.type === "image") {
			parts.push("[image]");
		}
	}

	return parts.filter(Boolean).join("\n\n");
}

function describeEntry(treeList, node) {
	const entry = node.entry;

	switch (entry.type) {
		case "message": {
			const message = entry.message;

			if (message.role === "user") {
				return {
					kind: "USER",
					full: extractDetailContent(treeList, message.content, { includeToolCalls: true }) || "(empty)",
				};
			}

			if (message.role === "assistant") {
				return {
					kind: "ASSISTANT",
					full:
						extractDetailContent(treeList, message.content, { includeToolCalls: true, verboseToolCalls: true }) ||
						message.errorMessage ||
						(message.stopReason === "aborted" ? "(aborted)" : "(no content)"),
				};
			}

			if (message.role === "toolResult") {
				return {
					kind: "TOOL RESULT",
					toolName: message.toolName,
				};
			}

			if (message.role === "bashExecution") {
				return {
					kind: "BASH",
					full: normalizeDetail(message.command ?? "") || "(empty)",
					toolName: "bash",
				};
			}

			return {
				kind: String(message.role ?? "MESSAGE").toUpperCase(),
				full: `[${message.role ?? "message"}]`,
			};
		}

		case "custom_message":
			return {
				kind: entry.customType ? `${entry.customType}`.toUpperCase() : "CUSTOM MESSAGE",
				full: extractDetailContent(treeList, entry.content, { includeToolCalls: true }) || "(empty)",
			};

		case "compaction": {
			const tokenCount = Math.round((entry.tokensBefore ?? 0) / 1000);
			const fallback = `[compaction: ${tokenCount}k tokens]`;
			return {
				kind: "COMPACTION",
				full: normalizeDetail(entry.summary ?? fallback) || fallback,
			};
		}

		case "branch_summary":
			return {
				kind: "BRANCH SUMMARY",
				full: normalizeDetail(entry.summary ?? "") || "(empty)",
			};

		case "model_change":
			return {
				kind: "MODEL",
				full: `[model: ${entry.modelId}]`,
			};

		case "thinking_level_change":
			return {
				kind: "THINKING",
				full: `[thinking: ${entry.thinkingLevel}]`,
			};

		case "custom":
			return {
				kind: entry.customType ? `${entry.customType}`.toUpperCase() : "CUSTOM",
				full: entry.data === undefined ? `[custom: ${entry.customType}]` : safeJson(entry.data, 2),
			};

		case "label":
			return {
				kind: "LABEL",
				full: entry.label ?? "(cleared)",
			};

		case "session_info":
			return {
				kind: "SESSION TITLE",
				full: entry.name ?? "(empty)",
			};

		default:
			return {
				kind: "ENTRY",
				full: "[entry]",
			};
	}
}

function getVisibleTreeRows(tui) {
	return Math.max(5, Math.floor(tui.terminal.rows / 2) - (DETAIL_BODY_LINES + 2));
}

function getTreeSelector(result) {
	if (typeof result?.focus?.getTreeList === "function") return result.focus;
	if (typeof result?.component?.getTreeList === "function") return result.component;
	return null;
}

function isToolResultEntry(entry) {
	return entry.type === "message" && entry.message.role === "toolResult";
}

function getDetailBodyLines(lines, width, theme) {
	const bodyLines = lines.slice(0, DETAIL_BODY_LINES);

	if (lines.length > DETAIL_BODY_LINES) {
		const lastLineIndex = bodyLines.length - 1;
		bodyLines[lastLineIndex] =
			truncateToWidth(bodyLines[lastLineIndex], Math.max(1, width - 1), "") + theme.fg("muted", "…");
	}

	while (bodyLines.length < DETAIL_BODY_LINES) {
		bodyLines.push("");
	}

	return bodyLines;
}

export class TreeXWrapper {
	constructor(selector, mode, toolExecutionComponent) {
		this.selector = selector;
		this.treeList = selector.getTreeList();
		this.mode = mode;
		this.tui = mode.ui;
		this.toolExecutionComponent = toolExecutionComponent;
		patchTreeListRender(this.treeList);
	}

	updateVisibleRows() {
		this.treeList.maxVisibleLines = getVisibleTreeRows(this.tui);
	}

	get focused() {
		return this.selector.focused;
	}

	set focused(value) {
		this.selector.focused = value;
	}

	invalidate() {
		this.selector.invalidate();
	}

	handleInput(keyData) {
		this.updateVisibleRows();
		this.selector.handleInput(keyData);
		this.tui.requestRender();
	}

	renderStickyLeftLine(theme, width, stickyLeftDepth) {
		const badge = theme.bg(
			"selectedBg",
			` ${theme.bold(theme.fg("accent", "⇤"))} ${theme.bold(theme.fg("accent", `depth ${stickyLeftDepth}`))} `,
		);

		return fitLine(`  ${badge}`, width);
	}

	renderToolResultLines(entry, width) {
		const message = entry.message;
		const toolCall = this.treeList.toolCallMap.get(message.toolCallId);
		const component = new this.toolExecutionComponent(
			message.toolName,
			message.toolCallId,
			toolCall?.arguments ?? {},
			{ showImages: false },
			this.mode.getRegisteredToolDefinition(message.toolName),
			this.mode.ui,
			this.mode.sessionManager.getCwd(),
		);

		component.setExpanded(true);
		component.updateResult(message);
		return component.render(width).filter(hasVisibleText);
	}

	renderDetailPane(theme, width) {
		const selected = this.treeList.filteredNodes[this.treeList.selectedIndex];

		if (!selected) {
			return [
				fitLine(theme.fg("muted", "NO SELECTION"), width),
				...Array.from({ length: DETAIL_BODY_LINES }, () => fitLine("", width)),
				fitLine(theme.fg("border", "─".repeat(width)), width),
			];
		}

		const entry = selected.node.entry;
		const info = describeEntry(this.treeList, selected.node);
		const metadataParts = [
			theme.bold(theme.fg("accent", `DEPTH ${getDisplayDepth(this.treeList, selected)}`)),
			theme.bold(info.kind),
			theme.fg("muted", formatRelativeTime(entry.timestamp)),
		];

		if (info.toolName) metadataParts.push(theme.fg("muted", String(info.toolName).toUpperCase()));
		if (selected.node.label) metadataParts.push(theme.fg("warning", `[${selected.node.label}]`));
		if (entry.id === this.treeList.currentLeafId) metadataParts.push(theme.fg("accent", "CURRENT"));

		const contentLines = isToolResultEntry(entry)
			? this.renderToolResultLines(entry, width)
			: wrapTextWithAnsi(normalizeDetail(info.full) || "(no text)", width);
		const bodyLines = getDetailBodyLines(contentLines, width, theme);

		return [
			fitLine(metadataParts.join(theme.fg("muted", " · ")), width),
			...bodyLines.map((line) => fitLine(line, width)),
			fitLine(theme.fg("border", "─".repeat(width)), width),
		];
	}

	render(width) {
		const theme = getTheme();
		const renderWidth = Math.max(20, width);

		this.updateVisibleRows();
		const lines = [...this.selector.render(renderWidth)];
		const { stickyLeftDepth } = getStickyLeftState(this.treeList);

		if (stickyLeftDepth) {
			lines[6] = this.renderStickyLeftLine(theme, renderWidth, stickyLeftDepth);
		}

		return [...lines, ...this.renderDetailPane(theme, renderWidth)];
	}
}

export function installTreeXNativePatches(InteractiveMode, toolExecutionComponent) {
	const proto = InteractiveMode?.prototype;
	if (!proto || proto[PATCHED_SHOW_SELECTOR]) return;

	const originalShowSelector = proto.showSelector;
	proto[PATCHED_SHOW_SELECTOR] = true;

	proto.showSelector = function treexShowSelector(create) {
		return originalShowSelector.call(this, (done) => {
			const result = create(done);
			const selector = getTreeSelector(result);
			if (!selector) {
				return result;
			}

			const wrapper = new TreeXWrapper(selector, this, toolExecutionComponent);
			return { component: wrapper, focus: wrapper };
		});
	};
}
