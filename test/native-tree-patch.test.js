import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveMode, estimateTokens } from "@earendil-works/pi-coding-agent";

import {
	AssistantMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/index.js";
import { TreeSelectorComponent } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";
import { installTreeXNativePatches } from "../src/treex-component.ts";
import treexExtension from "../treex.ts";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

function createTheme() {
	return {
		fg: (_name, text) => text,
		bg: (_name, text) => text,
		bold: (text) => text,
		italic: (text) => text,
	};
}

function createStyledTheme() {
	return {
		fg: (_name, text) => `\u001b[31m${text}\u001b[39m`,
		bg: (_name, text) => `\u001b[44m${text}\u001b[49m`,
		bold: (text) => `\u001b[1m${text}\u001b[22m`,
		italic: (text) => `\u001b[3m${text}\u001b[23m`,
	};
}

function createInteractiveModeClass() {
	return class InteractiveMode {
		constructor(rows = 24) {
			this.ui = {
				terminal: { rows },
				setFocus: (focus) => {
					this.focus = focus;
				},
				requestRender: () => {},
			};
			this.editor = { name: "editor" };
			this.editorContainer = {
				clear: () => {
					this.cleared = true;
				},
				addChild: (child) => {
					this.child = child;
				},
			};
			this.sessionManager = {
				getLeafId: () => "branch-5",
				getCwd: () => process.cwd(),
			};
		}

		getRegisteredToolDefinition() {
			return undefined;
		}

		getMarkdownThemeWithSettings() {
			return {};
		}

		getUserMessageText(message) {
			if (message.role !== "user") return "";
			if (typeof message.content === "string") return message.content;
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("");
		}

		showSelector(create) {
			const done = () => {
				this.editorContainer.clear();
				this.editorContainer.addChild(this.editor);
				this.ui.setFocus(this.editor);
			};

			const { component, focus } = create(done);
			this.editorContainer.clear();
			this.editorContainer.addChild(component);
			this.ui.setFocus(focus);
			this.ui.requestRender();
		}
	};
}

function makeNode(id, parentId, text, children = []) {
	return {
		entry: {
			id,
			parentId,
			timestamp: "2024-01-01T00:00:00.000Z",
			type: "message",
			message: {
				role: "user",
				content: text,
			},
		},
		children,
	};
}

function makeMessageNode(id, parentId, message, children = []) {
	return {
		entry: {
			id,
			parentId,
			timestamp: "2024-01-01T00:00:00.000Z",
			type: "message",
			message,
		},
		children,
	};
}

function collectEntries(tree) {
	const entries = [];
	const stack = [...tree].reverse();

	while (stack.length > 0) {
		const node = stack.pop();
		entries.push(node.entry);
		for (let index = node.children.length - 1; index >= 0; index--) {
			stack.push(node.children[index]);
		}
	}

	return entries;
}

function getBranchEntries(tree, entryId) {
	const entries = collectEntries(tree);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch = [];
	let currentId = entryId;

	while (currentId) {
		const entry = byId.get(currentId);
		if (!entry) break;
		branch.push(entry);
		currentId = entry.parentId;
	}

	return branch.reverse();
}

function createTree() {
	const branch8 = makeNode("branch-8", "branch-7", "branch message 8");
	const branch7 = makeNode("branch-7", "branch-6", "branch message 7", [branch8]);
	const branch6 = makeNode("branch-6", "branch-5", "branch message 6", [branch7]);
	const branch5 = makeNode("branch-5", "branch-4", "selected branch message", [branch6]);
	const branch4 = makeNode("branch-4", "branch-3", "branch message 4", [branch5]);
	const branch3 = makeNode("branch-3", "branch-2", "branch message 3", [branch4]);
	const branch2 = makeNode("branch-2", "branch-1", "branch message 2", [branch3]);
	const branch1 = makeNode("branch-1", "branch", "branch message 1", [branch2]);
	const branch = makeNode("branch", "root", "branch start", [branch1]);
	const sibling = makeNode("sibling", "root", "sibling branch");
	const root = makeNode("root", null, "root", [branch, sibling]);
	return [root];
}

function createToolResultTree() {
	const toolResult = makeMessageNode("tool-result", "assistant-tool-call", {
		role: "toolResult",
		toolCallId: "call-bash-1",
		toolName: "bash",
		content: [{ type: "text", text: "line 1\nline 2" }],
		isError: false,
	});
	const assistantToolCall = makeMessageNode(
		"assistant-tool-call",
		"user-root",
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call-bash-1",
					name: "bash",
					arguments: { command: "echo hello" },
				},
			],
			stopReason: "toolUse",
		},
		[toolResult],
	);
	const userRoot = makeNode("user-root", null, "run the command", [assistantToolCall]);
	return [userRoot];
}

function createBashExecutionTree() {
	const bash = makeMessageNode("bash-detail", "user-root", {
		role: "bashExecution",
		command: "npm test",
		output: "line 1\nline 2",
		exitCode: 0,
		cancelled: false,
	});
	const userRoot = makeNode("user-root", null, "run tests", [bash]);
	return [userRoot];
}

function createAssistantDetailTree() {
	const assistant = makeMessageNode("assistant-detail", "user-root", {
		role: "assistant",
		content: [{ type: "text", text: "Hello\n\nI am the assistant\nAnd I'm here to help you" }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-test",
		usage: {
			input: 12000,
			output: 345,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 12345,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: 1704067200000,
	});
	const userRoot = makeNode("user-root", null, "say hello", [assistant]);
	return [userRoot];
}

function createNativeComponents({
	assistantMessageComponent = AssistantMessageComponent,
	bashExecutionComponent = BashExecutionComponent,
	branchSummaryMessageComponent = BranchSummaryMessageComponent,
	compactionSummaryMessageComponent = CompactionSummaryMessageComponent,
	customMessageComponent = CustomMessageComponent,
	toolExecutionComponent = ToolExecutionComponent,
	userMessageComponent = UserMessageComponent,
} = {}) {
	return {
		assistantMessageComponent,
		bashExecutionComponent,
		branchSummaryMessageComponent,
		compactionSummaryMessageComponent,
		customMessageComponent,
		toolExecutionComponent,
		userMessageComponent,
	};
}

function renderWrappedTree({
	tree = createTree(),
	leafId = "branch-5",
	initialSelectedId,
	filterMode,
	nativeComponents = createNativeComponents(),
	theme = createTheme(),
	modelRuntime = { getModel: () => undefined },
	outputPad = 1,
} = {}) {
	globalThis[THEME_KEY] = theme;

	const InteractiveMode = createInteractiveModeClass();
	installTreeXNativePatches(InteractiveMode, nativeComponents);

	const mode = new InteractiveMode(24);
	mode.outputPad = outputPad;
	const entries = collectEntries(tree);
	mode.sessionManager.getEntries = () => entries;
	mode.sessionManager.getBranch = (entryId = leafId) => getBranchEntries(tree, entryId);
	mode.session = {
		sessionManager: mode.sessionManager,
		modelRuntime,
	};

	const selector = new TreeSelectorComponent(
		tree,
		leafId,
		24,
		() => {},
		() => {},
		() => {},
		initialSelectedId,
		filterMode,
	);

	mode.showSelector(() => ({ component: selector, focus: selector }));
	return { mode, selector, lines: mode.child.render(80) };
}

function simulateWrappedTreeHelp(selector) {
	const helpLines = ["extra help one", "extra help two", "extra help three", "extra help four"];
	const renderNativeSelector = selector.render.bind(selector);
	selector.render = (width) => {
		const lines = renderNativeSelector(width);
		lines.splice(4, 0, ...helpLines);
		return lines;
	};
	return helpLines;
}

function findLine(lines, text) {
	return lines.find((line) => line.includes(text));
}

test("native tree patch can be removed and reinstalled", () => {
	const InteractiveMode = createInteractiveModeClass();
	const originalShowSelector = InteractiveMode.prototype.showSelector;
	const nativeComponents = createNativeComponents();

	const firstUnpatch = installTreeXNativePatches(InteractiveMode, nativeComponents);
	assert.notEqual(InteractiveMode.prototype.showSelector, originalShowSelector);

	firstUnpatch();
	assert.equal(InteractiveMode.prototype.showSelector, originalShowSelector);

	const secondUnpatch = installTreeXNativePatches(InteractiveMode, nativeComponents);
	assert.notEqual(InteractiveMode.prototype.showSelector, originalShowSelector);

	secondUnpatch();
	assert.equal(InteractiveMode.prototype.showSelector, originalShowSelector);
});

test("native tree patch wraps the real tree selector and renders without crashing", () => {
	const { mode, selector, lines } = renderWrappedTree();
	const wrapper = mode.child;
	const detailHeader = findLine(lines, "DEPTH");

	assert.notEqual(wrapper, selector);
	assert.equal(mode.focus, wrapper);
	assert.ok(findLine(lines, "depth 3"));
	assert.ok(lines.some((line) => line.includes("selected branch message")));
	assert.ok(lines.some((line) => line.includes("CURRENT")));
	assert.match(detailHeader ?? "", /\d+\/\d+ · DEPTH \d+ · CURRENT\s+│\s+USER/);
	assert.ok(findLine(lines, "selected branch message")?.startsWith("◆ "));
});

test("sticky-left removes the final indentation level on narrow terminals", () => {
	const { mode, lines: wideLines } = renderWrappedTree();
	const narrowLines = mode.child.render(40);
	const narrowCurrentLine = findLine(narrowLines, "selected branch message");
	const wideCurrentLine = findLine(wideLines, "selected branch message");

	assert.ok(narrowCurrentLine);
	assert.ok(wideCurrentLine);
	assert.equal(narrowCurrentLine.indexOf("• user:"), 2);
	assert.equal(wideCurrentLine.indexOf("• user:"), 5);
});

test("selector chrome is measured before placing the sticky-left status", () => {
	const { mode, selector } = renderWrappedTree();
	const wrappedHelpLines = simulateWrappedTreeHelp(selector);
	const lines = mode.child.render(80);
	const stickyStatusIndex = lines.findIndex((line) => line.includes("depth 3"));
	const firstTreeRowIndex = lines.findIndex((line) => line.includes("branch message 2"));

	for (const helpLine of wrappedHelpLines) {
		assert.ok(lines.includes(helpLine));
	}
	assert.equal(stickyStatusIndex + 1, firstTreeRowIndex);
	assert.ok(lines.some((line) => line.includes("Type to search:")));
});

test("expanded detail layout accounts for wrapped selector chrome", () => {
	const { mode, selector } = renderWrappedTree();
	simulateWrappedTreeHelp(selector);
	mode.child.handleInput("\x12");
	const lines = mode.child.render(80);

	assert.equal(lines.length, mode.ui.terminal.rows);
	assert.ok(lines.some((line) => line.includes("FULL USER MESSAGE")));
});

test("tree status is folded into the detail header", () => {
	const { lines } = renderWrappedTree({ filterMode: "no-tools" });
	const detailHeader = findLine(lines, "DEPTH");

	const detailHeaderIndex = lines.findIndex((line) => line.includes("DEPTH"));

	assert.match(detailHeader ?? "", /\d+\/\d+ · \[no-tools\] · DEPTH \d+/);
	assert.ok(!lines.some((line) => line.trim().startsWith("(") && line.includes("[no-tools]")));
	assert.ok(lines[detailHeaderIndex - 1]?.includes("─"));
});

test("current row gets an accent marker when it is visible but not selected", () => {
	const { lines } = renderWrappedTree({ initialSelectedId: "branch-6" });
	const currentLine = findLine(lines, "selected branch message");
	const detailHeader = findLine(lines, "DEPTH");

	assert.ok(currentLine?.startsWith("◆ "));
	assert.ok(currentLine?.includes("│     • user: selected branch message"));
	assert.ok(lines.some((line) => line.includes("↑ CURRENT")));
	assert.match(detailHeader ?? "", /DEPTH \d+ · ↑ CURRENT\s+│/);
});

test("detail pane shows when current is below the selected row", () => {
	const { lines } = renderWrappedTree({ initialSelectedId: "branch-4" });
	const detailHeader = findLine(lines, "DEPTH");

	assert.ok(lines.some((line) => line.includes("↓ CURRENT")));
	assert.match(detailHeader ?? "", /DEPTH \d+ · ↓ CURRENT\s+│/);
});

test("current row marker stays visible when its surrounding branch is folded", () => {
	const { mode } = renderWrappedTree();
	const treeList = mode.child.treeList;

	treeList.foldedNodes.add("branch-4");
	treeList.applyFilter();

	const lines = mode.child.render(80);
	const currentLine = findLine(lines, "branch message 4");

	assert.ok(!lines.some((line) => line.includes("selected branch message")));
	assert.ok(currentLine?.startsWith("◆ "));
	assert.ok(currentLine?.includes("branch message 4"));
});

test("current row marker is hidden when search filters out the current row", () => {
	const { mode } = renderWrappedTree({ initialSelectedId: "branch-4" });
	const treeList = mode.child.treeList;

	treeList.searchQuery = "branch message 4";
	treeList.applyFilter();

	const lines = mode.child.render(80);
	const detailHeader = findLine(lines, "DEPTH");

	assert.ok(!lines.some((line) => line.startsWith("◆ ")));
	assert.match(detailHeader ?? "", /DEPTH \d+ · ↓ CURRENT\s+│/);
});

test("tool result detail pane prioritizes result lines over the tool command", () => {
	const { lines } = renderWrappedTree({
		tree: createToolResultTree(),
		leafId: "tool-result",
		initialSelectedId: "tool-result",
		filterMode: "all",
		theme: createStyledTheme(),
	});

	assert.ok(!lines.some((line) => line.includes("$ echo hello")));
	assert.ok(lines.some((line) => line.includes("line 1")));
	assert.ok(lines.some((line) => line.includes("line 2")));
});

test("bash preview shows output without command/status chrome", () => {
	const { lines, mode } = renderWrappedTree({
		tree: createBashExecutionTree(),
		leafId: "bash-detail",
		initialSelectedId: "bash-detail",
		filterMode: "all",
	});

	assert.ok(lines.some((line) => line.includes("line 1")));
	assert.ok(lines.some((line) => line.includes("line 2")));
	assert.ok(!lines.some((line) => line.includes("$ npm test")));

	mode.child.handleInput("\x12");
	const expandedLines = mode.child.render(80);
	assert.ok(expandedLines.some((line) => line.includes("$ npm test")));
});

test("assistant detail uses ModelRuntime context and removes blank lines", () => {
	const { lines } = renderWrappedTree({
		tree: createAssistantDetailTree(),
		leafId: "assistant-detail",
		initialSelectedId: "assistant-detail",
		filterMode: "all",
		modelRuntime: {
			getModel(provider, modelId) {
				if (provider === "openai" && modelId === "gpt-test") {
					return { contextWindow: 100000 };
				}
				return undefined;
			},
		},
	});

	assert.ok(lines.some((line) => line.includes("12.3%/100k")));
	assert.ok(lines.some((line) => line.includes("Hello")));
	assert.ok(lines.some((line) => line.includes("I am the assistant")));
	assert.ok(lines.some((line) => line.includes("And I'm here to help you")));
});

function appendEntry(parent, entry) {
	const node = {
		entry: { parentId: parent.entry.id, timestamp: parent.entry.timestamp, ...entry },
		children: [],
	};
	parent.children.push(node);
	return node;
}

function renderContextTree(tree, selectedId) {
	return renderWrappedTree({
		tree,
		leafId: selectedId,
		filterMode: "all",
		modelRuntime: { getModel: () => ({ contextWindow: 100000 }) },
	});
}

for (const replacement of [null, { content: "short replacement" }]) {
	test(`context ${replacement === null ? "omission" : "replacement"} invalidates earlier usage at the selected row`, () => {
		const tree = createAssistantDetailTree();
		tree[0].entry.message.content = "x".repeat(40000);
		const assistant = tree[0].children[0];
		const edit = appendEntry(assistant, {
			id: "context-edit",
			type: "context_edit",
			targetId: "user-root",
			replacement,
		});
		const expectedTokens =
			estimateTokens(assistant.entry.message) +
			(replacement ? estimateTokens({ role: "user", content: replacement.content }) : 0);
		const { lines, mode } = renderContextTree(tree, edit.entry.id);
		assert.ok(findLine(lines, `${(expectedTokens / 1000).toFixed(1)}%/100k`));
		assert.ok(findLine(lines, "CONTEXT EDIT"));
		assert.ok(findLine(lines, `${replacement ? "Replace in" : "Omit from"} model context: user-root`));
		if (replacement) assert.ok(findLine(lines, replacement.content));

		mode.child.handleInput("\x12");
		const expanded = mode.child.render(80);
		assert.ok(findLine(expanded, "FULL CONTEXT EDIT"));
		if (replacement) assert.ok(findLine(expanded, replacement.content));

		// Later edits must not affect the estimate at an earlier selection.
		assert.ok(findLine(renderContextTree(tree, assistant.entry.id).lines, "12.3%/100k"));

		const response = appendEntry(edit, {
			id: "fresh-assistant",
			type: "message",
			message: {
				...assistant.entry.message,
				usage: { ...assistant.entry.message.usage, input: 2000, output: 0, totalTokens: 2000 },
			},
		});
		assert.ok(findLine(renderContextTree(tree, response.entry.id).lines, "2.0%/100k"));
	});
}

test("context is estimated when the only assistant is omitted", () => {
	const tree = createAssistantDetailTree();
	tree[0].entry.message.content = "x".repeat(8000);
	const edit = appendEntry(tree[0].children[0], {
		id: "omit-only-assistant",
		type: "context_edit",
		targetId: "assistant-detail",
		replacement: null,
	});
	assert.ok(findLine(renderContextTree(tree, edit.entry.id).lines, "2.0%/100k"));
});

test("context estimates resolve system deltas after edits", () => {
	const tree = createAssistantDetailTree();
	const assistant = tree[0].children[0];
	const system = appendEntry(assistant, {
		id: "system-initial",
		type: "message",
		message: { role: "system", content: "", sections: { guidance: "x".repeat(40000) }, timestamp: 0 },
	});
	const delta = appendEntry(system, {
		id: "system-delta",
		type: "message",
		message: { role: "system", content: "", sections: { guidance: "short guidance" }, timestamp: 0 },
	});
	const edit = appendEntry(delta, {
		id: "edit-with-system",
		type: "context_edit",
		targetId: "user-root",
		replacement: null,
	});
	const tokens = estimateTokens(assistant.entry.message) + estimateTokens(delta.entry.message);
	assert.ok(findLine(renderContextTree(tree, edit.entry.id).lines, `${(tokens / 1000).toFixed(1)}%/100k`));
});

test("zero-usage responses after edits do not hide the projected estimate", () => {
	const tree = createAssistantDetailTree();
	const assistant = tree[0].children[0];
	const edit = appendEntry(assistant, {
		id: "large-edit",
		type: "context_edit",
		targetId: "user-root",
		replacement: { content: "x".repeat(8000) },
	});
	const response = appendEntry(edit, {
		id: "zero-usage",
		type: "message",
		message: {
			...assistant.entry.message,
			usage: { ...assistant.entry.message.usage, input: 0, output: 0, totalTokens: 0 },
		},
	});
	const tokens = 2000 + 2 * estimateTokens(assistant.entry.message);
	assert.ok(findLine(renderContextTree(tree, response.entry.id).lines, `${(tokens / 1000).toFixed(1)}%/100k`));
});

test("edits on sibling branches do not affect the selected branch", () => {
	const tree = createAssistantDetailTree();
	const assistant = tree[0].children[0];
	appendEntry(assistant, {
		id: "sibling-edit",
		type: "context_edit",
		targetId: "user-root",
		replacement: null,
	});
	const sibling = appendEntry(assistant, {
		id: "sibling-user",
		type: "message",
		message: { role: "user", content: "x".repeat(4000) },
	});
	assert.ok(findLine(renderContextTree(tree, sibling.entry.id).lines, "13.3%/100k"));
});

test("context replacement drawer shows full structured content", () => {
	const tree = createAssistantDetailTree();
	const edit = appendEntry(tree[0].children[0], {
		id: "structured-edit",
		type: "context_edit",
		targetId: "user-root",
		replacement: { content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive" }] },
	});
	const { mode, lines } = renderContextTree(tree, edit.entry.id);
	assert.ok(findLine(lines, "Ctrl+R full"));
	mode.child.handleInput("\x12");
	const expanded = mode.child.render(80);
	assert.ok(findLine(expanded, "FULL CONTEXT EDIT"));
	mode.child.handleInput("\x1b[F");
	assert.ok(findLine(mode.child.render(80), "five"));
});

test("post-compaction usage must survive projection", () => {
	const tree = createAssistantDetailTree();
	const assistant = tree[0].children[0];
	const compaction = appendEntry(assistant, {
		id: "compaction",
		type: "compaction",
		summary: "Summary",
		firstKeptEntryId: assistant.entry.id,
		tokensBefore: 12345,
	});
	assert.ok(findLine(renderContextTree(tree, compaction.entry.id).lines, "?/100k"));
	const response = appendEntry(compaction, {
		id: "post-compaction",
		type: "message",
		message: assistant.entry.message,
	});
	assert.ok(findLine(renderContextTree(tree, response.entry.id).lines, "12.3%/100k"));
	const edit = appendEntry(response, {
		id: "omit-response",
		type: "context_edit",
		targetId: response.entry.id,
		replacement: null,
	});
	assert.ok(findLine(renderContextTree(tree, edit.entry.id).lines, "?/100k"));
});

test("custom entry string data renders as human text", () => {
	const tree = [
		{
			entry: {
				id: "custom-human",
				parentId: null,
				timestamp: "2024-01-01T00:00:00.000Z",
				type: "custom",
				customType: "note",
				data: "first line\nsecond line",
			},
			children: [],
		},
	];

	const { lines } = renderWrappedTree({
		tree,
		leafId: "custom-human",
		initialSelectedId: "custom-human",
		filterMode: "all",
	});

	const rendered = lines.join("\n");
	assert.match(rendered, /first line/);
	assert.match(rendered, /second line/);
	assert.doesNotMatch(rendered, /\\n/);
});

test("detail pane shows an inline review hint when content is truncated", () => {
	const truncatedTree = [
		makeMessageNode("long-assistant", null, {
			role: "assistant",
			content: [{ type: "text", text: "one\ntwo\nthree\nfour" }],
			stopReason: "stop",
		}),
	];
	const shortTree = [
		makeMessageNode("short-assistant", null, {
			role: "assistant",
			content: [{ type: "text", text: "one\ntwo\nthree" }],
			stopReason: "stop",
		}),
	];

	const { lines: truncatedLines } = renderWrappedTree({
		tree: truncatedTree,
		leafId: "long-assistant",
		initialSelectedId: "long-assistant",
		filterMode: "all",
	});
	const { lines: shortLines } = renderWrappedTree({
		tree: shortTree,
		leafId: "short-assistant",
		initialSelectedId: "short-assistant",
		filterMode: "all",
	});

	assert.ok(truncatedLines.some((line) => line.includes("Ctrl+R full")));
	assert.ok(!shortLines.some((line) => line.includes("Ctrl+R full")));
});

test("ctrl+r toggles a full detail drawer", () => {
	const tree = [
		makeMessageNode("long-assistant", null, {
			role: "assistant",
			content: [{ type: "text", text: "one\ntwo\nthree\nfour" }],
			stopReason: "stop",
		}),
	];
	const { mode } = renderWrappedTree({
		tree,
		leafId: "long-assistant",
		initialSelectedId: "long-assistant",
		filterMode: "all",
	});

	mode.child.handleInput("\x12");

	assert.equal(mode.focus, mode.child);
	assert.equal(mode.child.expandedDetail.expanded, true);
	const expandedLines = mode.child.render(60);
	assert.ok(expandedLines.some((line) => line.includes("FULL ASSISTANT MESSAGE")));
	assert.ok(expandedLines.some((line) => line.includes("one")));
	assert.ok(expandedLines.some((line) => line.includes("two")));
	assert.ok(expandedLines.some((line) => line.includes("three")));
	assert.ok(expandedLines.some((line) => line.includes("four")));
	assert.ok(expandedLines.some((line) => line.includes("Esc/Ctrl+R collapse")));

	mode.child.handleInput("\x1b");
	assert.equal(mode.child.expandedDetail.expanded, false);
});

test("detail pane pluralizes relative time metadata", () => {
	const cases = [
		{ ageMs: 3 * 60 * 1000, expected: "3 MINS AGO", unexpected: "3 MIN AGO" },
		{ ageMs: 3 * 60 * 60 * 1000, expected: "3 HRS AGO", unexpected: "3 HR AGO" },
		{ ageMs: 3 * 24 * 60 * 60 * 1000, expected: "3 DAYS AGO", unexpected: "3 DAY AGO" },
		{ ageMs: 3 * 30 * 24 * 60 * 60 * 1000, expected: "3 MOS AGO", unexpected: "3 MO AGO" },
		{ ageMs: 2 * 12 * 30 * 24 * 60 * 60 * 1000, expected: "2 YRS AGO", unexpected: "2 YR AGO" },
	];

	for (const { ageMs, expected, unexpected } of cases) {
		const tree = [makeNode("recent-root", null, "recent message")];
		tree[0].entry.timestamp = new Date(Date.now() - ageMs).toISOString();

		const { lines } = renderWrappedTree({
			tree,
			leafId: "recent-root",
			initialSelectedId: "recent-root",
			filterMode: "all",
		});

		assert.ok(lines.some((line) => line.includes(expected)));
		assert.ok(!lines.some((line) => line.includes(unexpected)));
	}
});

test("detail message components receive pi's configured output padding", () => {
	const constructorOutputPads = [];
	class TrackingUserMessageComponent {
		constructor(_text, _theme, outputPad) {
			constructorOutputPads.push(["user", outputPad]);
		}

		render() {
			return ["tracked user message"];
		}
	}

	class TrackingAssistantMessageComponent {
		constructor(_message, _hideThinking, _theme, _hiddenThinkingLabel, outputPad) {
			constructorOutputPads.push(["assistant", outputPad]);
		}

		render() {
			return ["tracked assistant message"];
		}
	}

	renderWrappedTree({
		nativeComponents: createNativeComponents({ userMessageComponent: TrackingUserMessageComponent }),
		outputPad: 3,
	});
	renderWrappedTree({
		tree: createAssistantDetailTree(),
		leafId: "assistant-detail",
		initialSelectedId: "assistant-detail",
		nativeComponents: createNativeComponents({
			assistantMessageComponent: TrackingAssistantMessageComponent,
		}),
		outputPad: 3,
	});

	assert.deepEqual(constructorOutputPads, [
		["user", 3],
		["assistant", 3],
	]);
});

test("detail pane can render user messages with native styling", () => {
	const { lines } = renderWrappedTree({
		tree: createAssistantDetailTree(),
		leafId: "assistant-detail",
		initialSelectedId: "user-root",
		theme: createStyledTheme(),
	});

	assert.ok(lines.some((line) => line.includes("\u001b[44m")));
	assert.ok(lines.some((line) => line.includes("say hello")));
});

test("treex patches the public runtime with a Bun virtual executable path", (t) => {
	const originalArgv1 = process.argv[1];
	const before = InteractiveMode.prototype.showSelector;
	t.after(() => {
		process.argv[1] = originalArgv1;
	});
	process.argv[1] = "/$bunfs/root/pi";

	let shutdown;
	const pi = {
		on(event, handler) {
			assert.equal(event, "session_shutdown");
			shutdown = handler;
			t.after(handler);
		},
	};

	treexExtension(pi);
	assert.notEqual(InteractiveMode.prototype.showSelector, before);

	shutdown();
	assert.equal(InteractiveMode.prototype.showSelector, before);

	treexExtension(pi);
	assert.notEqual(InteractiveMode.prototype.showSelector, before);
});
