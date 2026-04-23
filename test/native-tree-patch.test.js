import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { ToolExecutionComponent } from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import { TreeSelectorComponent } from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";
import { UserMessageComponent } from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/user-message.js";
import { installTreeXNativePatches } from "../src/treex-component.js";
import treexExtension from "../treex.js";

const THEME_KEY = Symbol.for("@mariozechner/pi-coding-agent:theme");

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
	toolExecutionComponent = ToolExecutionComponent,
	userMessageComponent = UserMessageComponent,
} = {}) {
	return {
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
	modelRegistry = { find: () => undefined },
} = {}) {
	globalThis[THEME_KEY] = theme;

	const InteractiveMode = createInteractiveModeClass();
	installTreeXNativePatches(InteractiveMode, nativeComponents);

	const mode = new InteractiveMode(24);
	const entries = collectEntries(tree);
	mode.sessionManager.getEntries = () => entries;
	mode.sessionManager.getBranch = (entryId = leafId) => getBranchEntries(tree, entryId);
	mode.session = {
		sessionManager: mode.sessionManager,
		modelRegistry,
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
	assert.ok(lines[6].includes("depth 3"));
	assert.ok(lines.some((line) => line.includes("selected branch message")));
	assert.ok(lines.some((line) => line.includes("CURRENT")));
	assert.ok(detailHeader?.trimEnd().endsWith("CURRENT"));
	assert.ok(findLine(lines, "selected branch message")?.startsWith("◆ "));
});

test("current row gets an accent marker when it is visible but not selected", () => {
	const { lines } = renderWrappedTree({ initialSelectedId: "branch-6" });
	const currentLine = findLine(lines, "selected branch message");
	const detailHeader = findLine(lines, "DEPTH");

	assert.ok(currentLine?.startsWith("◆ "));
	assert.ok(currentLine?.includes("│     • user: selected branch message"));
	assert.ok(lines.some((line) => line.includes("↑ CURRENT")));
	assert.ok(detailHeader?.trimEnd().endsWith("↑ CURRENT"));
});

test("detail pane shows when current is below the selected row", () => {
	const { lines } = renderWrappedTree({ initialSelectedId: "branch-4" });
	const detailHeader = findLine(lines, "DEPTH");

	assert.ok(lines.some((line) => line.includes("↓ CURRENT")));
	assert.ok(detailHeader?.trimEnd().endsWith("↓ CURRENT"));
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
	assert.ok(detailHeader?.trimEnd().endsWith("↓ CURRENT"));
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

test("detail pane removes blank lines from wrapped text content", () => {
	const { lines } = renderWrappedTree({
		tree: createAssistantDetailTree(),
		leafId: "assistant-detail",
		initialSelectedId: "assistant-detail",
		filterMode: "all",
		modelRegistry: {
			find(provider, modelId) {
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

test("treex entry patches the host pi InteractiveMode", async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-treex-host-"));
	const distDir = join(tempDir, "dist");
	const binDir = join(tempDir, "bin");
	const realCliPath = join(distDir, "cli.js");
	const symlinkCliPath = join(binDir, "pi");
	const indexPath = join(distDir, "index.js");
	const toolExecutionDir = join(distDir, "modes", "interactive", "components");
	const toolExecutionPath = join(toolExecutionDir, "tool-execution.js");
	const userMessagePath = join(toolExecutionDir, "user-message.js");

	await mkdir(distDir, { recursive: true });
	await mkdir(binDir, { recursive: true });
	await mkdir(toolExecutionDir, { recursive: true });
	await writeFile(join(tempDir, "package.json"), '{"type":"module"}\n');
	await writeFile(realCliPath, "export {};\n");
	await symlink("../dist/cli.js", symlinkCliPath);
	await writeFile(
		indexPath,
		["export class InteractiveMode {", "  showSelector(create) {", "    return create(() => {});", "  }", "}"].join(
			"\n",
		),
	);
	await writeFile(toolExecutionPath, "export class ToolExecutionComponent {}\n");
	await writeFile(userMessagePath, "export class UserMessageComponent {}\n");

	const originalArgv1 = process.argv[1];
	process.argv[1] = symlinkCliPath;

	try {
		const hostModule = await import(pathToFileURL(indexPath).href);
		const before = hostModule.InteractiveMode.prototype.showSelector;
		const handlers = new Map();

		await treexExtension({
			on(event, handler) {
				handlers.set(event, handler);
			},
		});
		assert.notEqual(hostModule.InteractiveMode.prototype.showSelector, before);

		assert.ok(handlers.has("session_shutdown"));
		await handlers.get("session_shutdown")();
		assert.equal(hostModule.InteractiveMode.prototype.showSelector, before);

		await treexExtension({
			on(event, handler) {
				handlers.set(event, handler);
			},
		});
		assert.notEqual(hostModule.InteractiveMode.prototype.showSelector, before);
	} finally {
		process.argv[1] = originalArgv1;
	}
});
