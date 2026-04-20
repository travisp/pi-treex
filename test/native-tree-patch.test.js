import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { ToolExecutionComponent } from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import { TreeSelectorComponent } from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";
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

function renderWrappedTree({
	tree = createTree(),
	leafId = "branch-5",
	initialSelectedId,
	filterMode,
	toolExecutionComponent,
} = {}) {
	globalThis[THEME_KEY] = createTheme();

	const InteractiveMode = createInteractiveModeClass();
	installTreeXNativePatches(InteractiveMode, toolExecutionComponent);

	const mode = new InteractiveMode(24);
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

test("native tree patch wraps the real tree selector and renders without crashing", () => {
	const { mode, selector, lines } = renderWrappedTree();
	const wrapper = mode.child;

	assert.notEqual(wrapper, selector);
	assert.equal(mode.focus, wrapper);
	assert.ok(lines[6].includes("depth 3"));
	assert.ok(lines.some((line) => line.includes("selected branch message")));
	assert.ok(lines.some((line) => line.includes("CURRENT")));
	assert.ok(findLine(lines, "selected branch message")?.startsWith("◆ "));
});

test("current row gets an accent marker when it is visible but not selected", () => {
	const { lines } = renderWrappedTree({ initialSelectedId: "branch-6" });
	const currentLine = findLine(lines, "selected branch message");

	assert.ok(currentLine?.startsWith("◆ "));
	assert.ok(currentLine?.includes("│     • user: selected branch message"));
});

test("tool result detail pane uses native tool rendering without images", () => {
	const { lines } = renderWrappedTree({
		tree: createToolResultTree(),
		leafId: "tool-result",
		initialSelectedId: "tool-result",
		filterMode: "all",
		toolExecutionComponent: ToolExecutionComponent,
	});

	assert.ok(lines.some((line) => line.includes("$ echo hello")));
	assert.ok(lines.some((line) => line.includes("line 1")));
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

	const originalArgv1 = process.argv[1];
	process.argv[1] = symlinkCliPath;

	try {
		const hostModule = await import(pathToFileURL(indexPath).href);
		const before = hostModule.InteractiveMode.prototype.showSelector;

		await treexExtension();

		assert.notEqual(hostModule.InteractiveMode.prototype.showSelector, before);
	} finally {
		process.argv[1] = originalArgv1;
	}
});
