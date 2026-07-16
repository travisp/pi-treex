import {
	buildSessionContext,
	calculateContextTokens,
	estimateTokens,
	getLastAssistantUsage,
	getLatestCompactionEntry,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const DETAIL_BODY_LINES = 3;
const COMPACT_DETAIL_LINES = DETAIL_BODY_LINES + 2;
const EXPANDED_DETAIL_CHROME_LINES = 4;
const EXPANDED_DETAIL_MIN_LINES = EXPANDED_DETAIL_CHROME_LINES + DETAIL_BODY_LINES;
const EXPANDED_DETAIL_PREFERRED_TREE_ROWS = 12;
const EXPANDED_DETAIL_COLLAPSE_HINT = "Esc/Ctrl+R collapse";
const CURRENT_ROW_MARKER = "◆";
const METADATA_SEPARATOR = " · ";
const METADATA_GROUP_SEPARATOR = "  │  ";
const REVIEW_DETAIL_KEY = Key.ctrl("r");
const TRUNCATED_DETAIL_HINT = "… Ctrl+R full";
const FILTER_LABELS = {
	"no-tools": "[no-tools]",
	"user-only": "[user]",
	"labeled-only": "[labeled]",
	all: "[all]",
};
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const SHOW_SELECTOR_PATCH = Symbol.for("pi-treex:show-selector-patch");
const ESCAPE_CODE = 27;
const BELL_CODE = 7;

function getTheme() {
	return globalThis[THEME_KEY];
}

function normalizeDetail(text) {
	return String(text ?? "")
		.replace(/\r/g, "")
		.replace(/\t/g, "    ")
		.trim();
}

function isAnsiFinalByte(char) {
	const code = char.charCodeAt(0);
	return code >= 0x40 && code <= 0x7e;
}

function getAnsiSequenceLength(text, startIndex) {
	if (text.charCodeAt(startIndex) !== ESCAPE_CODE) return 0;

	const marker = text[startIndex + 1];
	if (marker === "[") {
		let index = startIndex + 2;
		while (index < text.length && !isAnsiFinalByte(text[index])) {
			index++;
		}
		return index < text.length ? index - startIndex + 1 : 0;
	}

	if (marker !== "]" && marker !== "_") return 0;

	let index = startIndex + 2;
	while (index < text.length) {
		if (text.charCodeAt(index) === BELL_CODE) return index - startIndex + 1;
		if (text.charCodeAt(index) === ESCAPE_CODE && text[index + 1] === "\\") return index - startIndex + 2;
		index++;
	}
	return 0;
}

function stripAnsi(text) {
	let result = "";
	for (let index = 0; index < text.length; ) {
		const ansiLength = getAnsiSequenceLength(text, index);
		if (ansiLength) {
			index += ansiLength;
		} else {
			result += text[index];
			index++;
		}
	}
	return result;
}

function hasVisibleText(line) {
	return visibleWidth(stripAnsi(line).trim()) > 0;
}

function stringifyJson(value, spacing = 0) {
	return JSON.stringify(value, null, spacing) ?? "";
}

function formatCustomEntryData(data) {
	return typeof data === "string" ? normalizeDetail(data) : stringifyJson(data, 2);
}

function formatAgo(value, singular, plural = `${singular}S`) {
	return `${value} ${value === 1 ? singular : plural} AGO`;
}

function formatRelativeTime(timestamp) {
	const then = new Date(timestamp).getTime();
	if (!Number.isFinite(then)) return "UNKNOWN TIME";

	const diffMinutes = Math.floor(Math.max(0, Date.now() - then) / 60000);
	if (diffMinutes < 1) return "JUST NOW";
	if (diffMinutes < 60) return formatAgo(diffMinutes, "MIN");

	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return formatAgo(diffHours, "HR");

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return formatAgo(diffDays, "DAY");

	const diffMonths = Math.floor(diffDays / 30);
	if (diffMonths < 12) return formatAgo(diffMonths, "MO");

	return formatAgo(Math.floor(diffMonths / 12), "YR");
}

function fitLine(line, width) {
	return truncateToWidth(line, width, "...", true);
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

function getLeadingAnsiLength(line) {
	let length = 0;
	while (length < line.length) {
		const ansiLength = getAnsiSequenceLength(line, length);
		if (!ansiLength) break;
		length += ansiLength;
	}
	return length;
}

function replaceCursorSlot(line, replacement) {
	const prefixLength = getLeadingAnsiLength(line);
	// Native tree rows start with a 2-cell cursor slot ("› " or "  "), possibly after ANSI styling.
	return `${line.slice(0, prefixLength)}${replacement}${line.slice(prefixLength + 2)}`;
}

function markCurrentLine(treeList, lines) {
	if (!treeList.currentLeafId) return lines;

	const { startIndex, endIndex } = getVisibleWindow(treeList);
	let currentIndex = treeList.filteredNodes.findIndex((node) => node.node.entry.id === treeList.currentLeafId);
	if (currentIndex === -1) {
		if (treeList.foldedNodes.size === 0) return lines;
		currentIndex = treeList.findNearestVisibleIndex(treeList.currentLeafId);
	}
	if (currentIndex < startIndex || currentIndex >= endIndex) return lines;

	const theme = getTheme();
	const marker = `${theme.bold(theme.fg("accent", CURRENT_ROW_MARKER))} `;
	lines[currentIndex - startIndex] = replaceCursorSlot(lines[currentIndex - startIndex], marker);
	return lines;
}

function renderWithStickyLeft(treeList, width, originalRender) {
	const { startIndex, endIndex, stickyLeftShift } = getStickyLeftState(treeList);
	if (stickyLeftShift === 0) {
		return originalRender(width);
	}

	const originalNodes = [];
	for (let index = startIndex; index < endIndex; index++) {
		const flatNode = treeList.filteredNodes[index];
		const shiftedIndent = Math.max(0, getDisplayIndent(treeList, flatNode) - stickyLeftShift);

		originalNodes.push({
			flatNode,
			indent: flatNode.indent,
			gutters: flatNode.gutters,
		});

		flatNode.indent = treeList.multipleRoots ? shiftedIndent + 1 : shiftedIndent;
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
}

function patchTreeListRender(treeList) {
	if (treeList.__treexStickyLeftPatched) return;

	const originalRender = treeList.render.bind(treeList);
	treeList.__treexStickyLeftPatched = true;

	treeList.render = function renderStickyLeft(width) {
		const lines = renderWithStickyLeft(this, width, originalRender);
		lines.pop();
		return markCurrentLine(this, lines);
	};
}

function formatToolCallVerbose(name, args) {
	const json = stringifyJson(args, 2);
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
				full: entry.data === undefined ? `[custom: ${entry.customType}]` : formatCustomEntryData(entry.data),
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

function calculateTreeDetailLayout(terminalRows, detailExpanded, selectorChromeLines) {
	if (detailExpanded) {
		const availableRows = Math.max(1, terminalRows - selectorChromeLines);
		const treeRows = Math.min(
			EXPANDED_DETAIL_PREFERRED_TREE_ROWS,
			Math.max(1, availableRows - EXPANDED_DETAIL_MIN_LINES),
		);
		const detailBodyRows = Math.max(1, availableRows - treeRows - EXPANDED_DETAIL_CHROME_LINES);

		return { treeRows, detailBodyRows };
	}

	const preferredTreeRows = Math.max(5, Math.floor(terminalRows / 2) - COMPACT_DETAIL_LINES);
	const availableTreeRows = Math.max(1, terminalRows - selectorChromeLines - COMPACT_DETAIL_LINES);
	return {
		treeRows: Math.min(preferredTreeRows, availableTreeRows),
		detailBodyRows: DETAIL_BODY_LINES,
	};
}

function getRenderedTreeLineCount(treeList) {
	const { startIndex, endIndex } = getVisibleWindow(treeList);
	// The native tree renders a single "No entries found" row when the window is empty.
	if (startIndex === endIndex) return 1;
	return endIndex - startIndex;
}

// Detail pane context helpers
function getDetailContextUsage(session, entry) {
	const branchEntries = session.sessionManager.getBranch(entry.id);
	const sessionContext = buildSessionContext(session.sessionManager.getEntries(), entry.id);
	const modelIdentity = sessionContext.model ?? findLastAssistantModel(branchEntries);
	if (!modelIdentity) return null;

	const contextWindow = session.modelRuntime.getModel(modelIdentity.provider, modelIdentity.modelId)?.contextWindow;
	if (!contextWindow) return null;

	const latestCompaction = getLatestCompactionEntry(branchEntries);
	if (latestCompaction) {
		const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
		const usage = getLastAssistantUsage(branchEntries.slice(compactionIndex + 1));
		if (!usage || calculateContextTokens(usage) === 0) {
			return { percent: null, contextWindow };
		}
	}

	return {
		percent: (estimateContextTokensFromMessages(sessionContext.messages) / contextWindow) * 100,
		contextWindow,
	};
}

function findLastAssistantModel(branchEntries) {
	for (let index = branchEntries.length - 1; index >= 0; index--) {
		const entry = branchEntries[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (!entry.message.provider || !entry.message.model) continue;
		return {
			provider: entry.message.provider,
			modelId: entry.message.model,
		};
	}

	return null;
}

function estimateContextTokensFromMessages(messages) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		if (message.stopReason === "aborted" || message.stopReason === "error" || !message.usage) continue;

		let trailingTokens = 0;
		for (let trailingIndex = index + 1; trailingIndex < messages.length; trailingIndex++) {
			trailingTokens += estimateTokens(messages[trailingIndex]);
		}

		return calculateContextTokens(message.usage) + trailingTokens;
	}

	let estimatedTokens = 0;
	for (const message of messages) {
		estimatedTokens += estimateTokens(message);
	}
	return estimatedTokens;
}

function formatShortTokenCount(count) {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatDetailContextUsage(theme, contextUsage) {
	if (!contextUsage) return null;

	const display =
		contextUsage.percent === null
			? `?/${formatShortTokenCount(contextUsage.contextWindow)}`
			: `${contextUsage.percent.toFixed(1)}%/${formatShortTokenCount(contextUsage.contextWindow)}`;

	if (contextUsage.percent === null) {
		return theme.fg("muted", display);
	}
	if (contextUsage.percent > 90) {
		return theme.fg("error", display);
	}
	if (contextUsage.percent > 70) {
		return theme.fg("warning", display);
	}
	return theme.fg("muted", display);
}

function getCurrentDirection(treeList, selected) {
	if (!treeList.currentLeafId || selected.node.entry.id === treeList.currentLeafId) return null;

	const currentFlatIndex = treeList.flatNodes.findIndex((node) => node.node.entry.id === treeList.currentLeafId);
	const selectedFlatIndex = treeList.flatNodes.findIndex((node) => node.node.entry.id === selected.node.entry.id);
	return currentFlatIndex < selectedFlatIndex ? "up" : "down";
}

function getCurrentPositionPart(treeList, selected, theme) {
	if (selected.node.entry.id === treeList.currentLeafId) {
		return theme.fg("accent", "CURRENT");
	}

	const currentDirection = getCurrentDirection(treeList, selected);
	if (!currentDirection) return null;

	return theme.bold(theme.fg("accent", currentDirection === "up" ? "↑ CURRENT" : "↓ CURRENT"));
}

function getTreeFilterParts(treeList, theme) {
	const filterLabel = FILTER_LABELS[treeList.filterMode];
	const labels = filterLabel ? [filterLabel] : [];

	if (treeList.showLabelTimestamps) {
		labels.push("[+label time]");
	}

	return labels.map((label) => theme.fg("muted", label));
}

function joinMetadataParts(theme, parts) {
	return parts.filter(Boolean).join(theme.fg("muted", METADATA_SEPARATOR));
}

function getTreeSelector(result) {
	if (typeof result?.focus?.getTreeList === "function") return result.focus;
	if (typeof result?.component?.getTreeList === "function") return result.component;
	return null;
}

function isToolResultEntry(entry) {
	return entry.type === "message" && entry.message.role === "toolResult";
}

function compactDetailLines(lines) {
	return lines.filter(hasVisibleText);
}

function removeSharedPrefix(baseLines, lines) {
	let index = 0;
	while (
		index < baseLines.length &&
		index < lines.length &&
		stripAnsi(lines[index]).trimEnd() === stripAnsi(baseLines[index]).trimEnd()
	) {
		index++;
	}
	return lines.slice(index);
}

function appendTruncatedDetailHint(line, width, theme) {
	const hintWidth = visibleWidth(TRUNCATED_DETAIL_HINT);
	const hint = theme.fg("muted", TRUNCATED_DETAIL_HINT);

	if (width <= hintWidth) {
		return truncateToWidth(hint, width);
	}

	return truncateToWidth(line, Math.max(1, width - hintWidth), "") + hint;
}

function getDetailBodyLines(lines, width, theme) {
	const bodyLines = lines.slice(0, DETAIL_BODY_LINES);

	if (lines.length > DETAIL_BODY_LINES) {
		const lastLineIndex = bodyLines.length - 1;
		bodyLines[lastLineIndex] = appendTruncatedDetailHint(bodyLines[lastLineIndex], width, theme);
	}

	while (bodyLines.length < DETAIL_BODY_LINES) {
		bodyLines.push("");
	}

	return bodyLines;
}

function formatFullDetailTitle(info) {
	if (info.kind === "USER" || info.kind === "ASSISTANT") {
		return `FULL ${info.kind} MESSAGE`;
	}

	const titleParts = [`FULL ${info.kind}`];
	if (info.toolName) titleParts.push(String(info.toolName).toUpperCase());
	return titleParts.join(" · ");
}

function renderCompactComponentLines(component, width) {
	return compactDetailLines(component.render(width));
}

function renderPlainTextLines(text, width) {
	return wrapTextWithAnsi(normalizeDetail(text) || "(no text)", width);
}

function renderCompactPlainTextLines(text, width) {
	return compactDetailLines(renderPlainTextLines(text, width));
}

function removeNativeTreeTrailingSpacer(lines) {
	const result = [...lines];
	result.splice(-2, 1);
	return result;
}

class ExpandedDetailPane {
	constructor() {
		this.expanded = false;
		this.scrollOffset = 0;
		this.bodyHeight = DETAIL_BODY_LINES;
	}

	toggle() {
		if (this.expanded) {
			this.collapse();
		} else {
			this.expanded = true;
			this.scrollOffset = 0;
		}
	}

	collapse() {
		this.expanded = false;
		this.scrollOffset = 0;
	}

	handleInput(keyData) {
		if (matchesKey(keyData, Key.escape) || matchesKey(keyData, Key.ctrl("c"))) {
			this.collapse();
			return;
		}
		if (matchesKey(keyData, Key.up)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			return;
		}
		if (matchesKey(keyData, Key.down)) {
			this.scrollOffset++;
			return;
		}
		if (matchesKey(keyData, Key.pageUp) || matchesKey(keyData, Key.left)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.bodyHeight);
			return;
		}
		if (matchesKey(keyData, Key.pageDown) || matchesKey(keyData, Key.right)) {
			this.scrollOffset += this.bodyHeight;
			return;
		}
		if (matchesKey(keyData, Key.home)) {
			this.scrollOffset = 0;
			return;
		}
		if (matchesKey(keyData, Key.end)) {
			this.scrollOffset = Number.POSITIVE_INFINITY;
		}
	}

	renderEmpty(theme, width) {
		return [
			fitLine(theme.fg("muted", "NO SELECTION"), width),
			fitLine(theme.fg("border", "─".repeat(width)), width),
			...Array.from({ length: this.bodyHeight }, () => fitLine("", width)),
			fitLine(theme.fg("muted", EXPANDED_DETAIL_COLLAPSE_HINT), width),
			fitLine(theme.fg("border", "─".repeat(width)), width),
		];
	}

	render(theme, width, title, contentLines) {
		const lines = contentLines.length ? contentLines : [theme.fg("muted", "(no text)")];
		const maxOffset = Math.max(0, lines.length - this.bodyHeight);
		this.scrollOffset = Math.min(Math.max(0, this.scrollOffset), maxOffset);

		const visibleLines = lines.slice(this.scrollOffset, this.scrollOffset + this.bodyHeight);
		while (visibleLines.length < this.bodyHeight) {
			visibleLines.push("");
		}

		const firstVisibleLine = Math.min(lines.length, this.scrollOffset + 1);
		const lastVisibleLine = Math.min(lines.length, this.scrollOffset + this.bodyHeight);
		const percent = lines.length <= this.bodyHeight ? 100 : Math.round((lastVisibleLine / lines.length) * 100);
		const footerParts = [
			EXPANDED_DETAIL_COLLAPSE_HINT,
			`${firstVisibleLine}-${lastVisibleLine}/${lines.length}`,
			`${percent}%`,
			"↑↓ scroll",
			"←/→ page",
			"Home/End",
		];

		return [
			fitLine(theme.bold(title), width),
			fitLine(theme.fg("border", "─".repeat(width)), width),
			...visibleLines.map((line) => fitLine(line, width)),
			fitLine(theme.fg("muted", footerParts.join(METADATA_SEPARATOR)), width),
			fitLine(theme.fg("border", "─".repeat(width)), width),
		];
	}
}

class DetailContentRenderer {
	constructor(mode, treeList, components) {
		this.mode = mode;
		this.treeList = treeList;
		this.tui = mode.ui;
		this.components = components;
	}

	createToolExecutionComponent(entry) {
		const message = entry.message;
		const toolCall = this.treeList.toolCallMap.get(message.toolCallId);
		return new this.components.toolExecutionComponent(
			message.toolName,
			message.toolCallId,
			toolCall?.arguments ?? {},
			{ showImages: false },
			this.mode.getRegisteredToolDefinition(message.toolName),
			this.tui,
			this.mode.sessionManager.getCwd(),
		);
	}

	createUserMessageComponent(entry) {
		const text = this.mode.getUserMessageText(entry.message);
		return new this.components.userMessageComponent(
			text,
			this.mode.getMarkdownThemeWithSettings(),
			this.mode.outputPad,
		);
	}

	createAssistantMessageComponent(entry) {
		return new this.components.assistantMessageComponent(
			entry.message,
			this.mode.hideThinkingBlock,
			this.mode.getMarkdownThemeWithSettings(),
			this.mode.hiddenThinkingLabel,
			this.mode.outputPad,
		);
	}

	renderBashExecutionLines(entry, width) {
		const message = entry.message;
		const component = new this.components.bashExecutionComponent(message.command, this.tui, message.excludeFromContext);
		if (message.output) {
			component.appendOutput(message.output);
		}
		component.setExpanded(true);
		component.setComplete(
			message.exitCode,
			message.cancelled,
			message.truncated ? { truncated: true } : undefined,
			message.fullOutputPath,
		);
		return component.render(width);
	}

	renderBashPreviewLines(entry, width) {
		const message = entry.message;
		const output = normalizeDetail(message.output);
		const text = output || normalizeDetail(message.command) || "(no output)";
		const theme = getTheme();
		return compactDetailLines(wrapTextWithAnsi(theme.fg("muted", text), width));
	}

	renderExpandableEntryLines(Component, message, width) {
		const component = new Component(message, this.mode.getMarkdownThemeWithSettings());
		component.setExpanded(true);
		return component.render(width);
	}

	renderCustomMessageLines(entry, width) {
		const renderer = this.mode.session.extensionRunner?.getMessageRenderer?.(entry.customType);
		const component = new this.components.customMessageComponent(
			entry,
			renderer,
			this.mode.getMarkdownThemeWithSettings(),
		);
		component.setExpanded(true);
		return component.render(width);
	}

	renderToolLines(entry, width, result) {
		const component = this.createToolExecutionComponent(entry);
		component.setExpanded(true);
		if (result) {
			component.updateResult(result);
		}
		return component.render(width);
	}

	renderToolResultPreviewLines(entry, width) {
		const callLines = compactDetailLines(this.renderToolLines(entry, width));
		const fullLines = compactDetailLines(this.renderToolLines(entry, width, entry.message));
		const resultLines = removeSharedPrefix(callLines, fullLines);
		return resultLines.length > 0 ? resultLines : fullLines;
	}

	renderPreview(entry, info, width) {
		if (isToolResultEntry(entry)) {
			return this.renderToolResultPreviewLines(entry, width);
		}

		if (entry.type === "message") {
			switch (entry.message.role) {
				case "user":
					return renderCompactComponentLines(this.createUserMessageComponent(entry), width);
				case "assistant":
					return renderCompactComponentLines(this.createAssistantMessageComponent(entry), width);
				case "bashExecution":
					return this.renderBashPreviewLines(entry, width);
			}
		}

		return renderCompactPlainTextLines(info.full, width);
	}

	renderExpanded(entry, info, width) {
		if (isToolResultEntry(entry)) {
			return this.renderToolLines(entry, width, entry.message);
		}

		if (entry.type === "message") {
			switch (entry.message.role) {
				case "user":
					return this.createUserMessageComponent(entry).render(width);
				case "assistant":
					return this.createAssistantMessageComponent(entry).render(width);
				case "bashExecution":
					return this.renderBashExecutionLines(entry, width);
			}
		}

		if (entry.type === "compaction") {
			return this.renderExpandableEntryLines(this.components.compactionSummaryMessageComponent, entry, width);
		}

		if (entry.type === "branch_summary") {
			return this.renderExpandableEntryLines(this.components.branchSummaryMessageComponent, entry, width);
		}

		if (entry.type === "custom_message") {
			return this.renderCustomMessageLines(entry, width);
		}

		return renderPlainTextLines(info.full, width);
	}
}

class TreeXWrapper {
	constructor(selector, mode, nativeComponents) {
		this.selector = selector;
		this.treeList = selector.getTreeList();
		this.mode = mode;
		this.tui = mode.ui;
		this.detailContent = new DetailContentRenderer(mode, this.treeList, nativeComponents);
		this.expandedDetail = new ExpandedDetailPane();
		patchTreeListRender(this.treeList);
	}

	renderSelector(width) {
		const lines = removeNativeTreeTrailingSpacer(this.selector.render(width));
		const treeLineCount = this.selector.labelInput ? 0 : getRenderedTreeLineCount(this.treeList);
		return { lines, treeLineCount };
	}

	renderSelectorWithLayout(width) {
		// Pi's tree help wraps based on terminal width. Measure its rendered chrome,
		// then give the remaining rows to the tree and detail pane.
		let rendered = this.renderSelector(width);
		const selectorChromeLines = rendered.lines.length - rendered.treeLineCount;
		const { treeRows, detailBodyRows } = calculateTreeDetailLayout(
			this.tui.terminal.rows,
			this.expandedDetail.expanded,
			selectorChromeLines,
		);

		this.expandedDetail.bodyHeight = detailBodyRows;
		if (this.treeList.maxVisibleLines !== treeRows) {
			this.treeList.maxVisibleLines = treeRows;
			rendered = this.renderSelector(width);
		}

		return rendered;
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
		if (!this.selector.labelInput && matchesKey(keyData, REVIEW_DETAIL_KEY)) {
			this.expandedDetail.toggle();
		} else if (this.expandedDetail.expanded) {
			this.expandedDetail.handleInput(keyData);
		} else {
			this.selector.handleInput(keyData);
		}

		this.tui.requestRender();
	}

	renderStickyLeftLine(theme, width, stickyLeftDepth) {
		const badge = theme.bg(
			"selectedBg",
			` ${theme.bold(theme.fg("accent", "⇤"))} ${theme.bold(theme.fg("accent", `depth ${stickyLeftDepth}`))} `,
		);

		return fitLine(`  ${badge}`, width);
	}

	getSelectedNode() {
		return this.treeList.filteredNodes[this.treeList.selectedIndex] ?? null;
	}

	getDetailMetadata(theme, selected, info) {
		const entry = selected.node.entry;
		const contextUsage = getDetailContextUsage(this.mode.session, entry);
		const treeParts = [
			theme.fg("muted", `${this.treeList.selectedIndex + 1}/${this.treeList.filteredNodes.length}`),
			...getTreeFilterParts(this.treeList, theme),
			theme.bold(theme.fg("accent", `DEPTH ${getDisplayDepth(this.treeList, selected)}`)),
			getCurrentPositionPart(this.treeList, selected, theme),
		];

		const entryParts = [theme.bold(info.kind), theme.fg("muted", formatRelativeTime(entry.timestamp))];
		if (info.toolName) entryParts.push(theme.fg("muted", String(info.toolName).toUpperCase()));
		if (selected.node.label) entryParts.push(theme.fg("warning", `[${selected.node.label}]`));

		const metadataGroups = [joinMetadataParts(theme, treeParts), joinMetadataParts(theme, entryParts)];
		const contextPart = formatDetailContextUsage(theme, contextUsage);
		if (contextPart) {
			metadataGroups.push(joinMetadataParts(theme, [theme.fg("muted", "CTX"), contextPart]));
		}

		return metadataGroups.join(theme.fg("muted", METADATA_GROUP_SEPARATOR));
	}

	renderDetailPane(theme, width) {
		const selected = this.getSelectedNode();
		if (!selected) {
			return [
				fitLine(theme.fg("muted", "NO SELECTION"), width),
				...Array.from({ length: DETAIL_BODY_LINES }, () => fitLine("", width)),
				fitLine(theme.fg("border", "─".repeat(width)), width),
			];
		}

		const entry = selected.node.entry;
		const info = describeEntry(this.treeList, selected.node);
		const bodyLines = getDetailBodyLines(this.detailContent.renderPreview(entry, info, width), width, theme);

		return [
			fitLine(this.getDetailMetadata(theme, selected, info), width),
			...bodyLines.map((line) => fitLine(line, width)),
			fitLine(theme.fg("border", "─".repeat(width)), width),
		];
	}

	renderExpandedDetailPane(theme, width) {
		const selected = this.getSelectedNode();
		if (!selected) {
			return this.expandedDetail.renderEmpty(theme, width);
		}

		const entry = selected.node.entry;
		const info = describeEntry(this.treeList, selected.node);

		return this.expandedDetail.render(
			theme,
			width,
			formatFullDetailTitle(info),
			this.detailContent.renderExpanded(entry, info, width),
		);
	}

	render(width) {
		const theme = getTheme();
		const renderWidth = Math.max(20, width);

		const { lines, treeLineCount } = this.renderSelectorWithLayout(renderWidth);
		const { stickyLeftDepth } = getStickyLeftState(this.treeList);

		if (stickyLeftDepth && treeLineCount > 0) {
			// The native bottom border remains after the tree rows. Replace the
			// spacer immediately before those rows without assuming a chrome height.
			const firstTreeLineIndex = lines.length - treeLineCount - 1;
			lines[firstTreeLineIndex - 1] = this.renderStickyLeftLine(theme, renderWidth, stickyLeftDepth);
		}

		const detailLines = this.expandedDetail.expanded
			? this.renderExpandedDetailPane(theme, renderWidth)
			: this.renderDetailPane(theme, renderWidth);

		return [...lines, ...detailLines];
	}
}

function uninstallTreeXNativePatches(InteractiveMode) {
	const proto = InteractiveMode.prototype;
	const patch = proto[SHOW_SELECTOR_PATCH];
	if (!patch) return;

	if (proto.showSelector === patch.patched) {
		proto.showSelector = patch.original;
	}
	delete proto[SHOW_SELECTOR_PATCH];
}

export function installTreeXNativePatches(InteractiveMode, nativeComponents) {
	const proto = InteractiveMode.prototype;
	uninstallTreeXNativePatches(InteractiveMode);

	const originalShowSelector = proto.showSelector;
	const patchedShowSelector = function treexShowSelector(create) {
		return originalShowSelector.call(this, (done) => {
			const result = create(done);
			const selector = getTreeSelector(result);
			if (!selector) {
				return result;
			}

			const wrapper = new TreeXWrapper(selector, this, nativeComponents);
			return { component: wrapper, focus: wrapper };
		});
	};

	proto.showSelector = patchedShowSelector;
	proto[SHOW_SELECTOR_PATCH] = {
		original: originalShowSelector,
		patched: patchedShowSelector,
	};
	return () => uninstallTreeXNativePatches(InteractiveMode);
}
