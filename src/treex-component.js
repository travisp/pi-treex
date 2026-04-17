import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { TreeSelectorComponent as UpstreamTreeSelectorComponent } from "../vendor/pi/modes/interactive/components/tree-selector.js";
import { keyText as upstreamKeyText } from "../vendor/pi/modes/interactive/components/keybinding-hints.js";

const DETAIL_BODY_LINES = 3;

function normalizeDetail(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/\t/g, "    ")
    .trim();
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

  const diffMs = Math.max(0, Date.now() - then);
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "JUST NOW";
  if (diffMinutes < 60) return `${diffMinutes} MIN AGO`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} HR AGO`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} DAY AGO`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} MO AGO`;

  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears} YR AGO`;
}

function fitLine(line, width) {
  const truncated = truncateToWidth(line, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function updateTreeNodeLabel(tree, entryId, label, labelTimestamp = new Date().toISOString()) {
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.entry.id === entryId) {
      node.label = label;
      node.labelTimestamp = label ? labelTimestamp : undefined;
      return;
    }
    for (const child of node.children ?? []) stack.push(child);
  }
}

function getNestedDisplayIndent(treeList, flatNode) {
  return treeList.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;
}

function getNestedVisibleWindow(treeList) {
  if (treeList.filteredNodes.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const startIndex = Math.max(
    0,
    Math.min(treeList.selectedIndex - Math.floor(treeList.maxVisibleLines / 2), treeList.filteredNodes.length - treeList.maxVisibleLines),
  );

  return {
    startIndex,
    endIndex: Math.min(startIndex + treeList.maxVisibleLines, treeList.filteredNodes.length),
  };
}

function getNestedStickyLeftMetrics(treeList) {
  const { startIndex, endIndex } = getNestedVisibleWindow(treeList);
  if (startIndex === endIndex) {
    return {
      startIndex,
      endIndex,
      stickyLeftShift: 0,
      stickyLeftDepth: null,
    };
  }

  let minVisibleDisplayIndent = Infinity;
  for (let index = startIndex; index < endIndex; index++) {
    minVisibleDisplayIndent = Math.min(minVisibleDisplayIndent, getNestedDisplayIndent(treeList, treeList.filteredNodes[index]));
  }

  const stickyLeftShift = Math.max(0, minVisibleDisplayIndent - 1);

  return {
    startIndex,
    endIndex,
    stickyLeftShift,
    stickyLeftDepth: stickyLeftShift > 0 ? minVisibleDisplayIndent + 1 : null,
  };
}

function shiftNestedGutters(gutters, stickyLeftShift) {
  if (stickyLeftShift === 0) return gutters;

  return gutters.map((gutter) => ({ ...gutter, position: gutter.position - stickyLeftShift })).filter((gutter) => gutter.position >= 0);
}

function patchNestedTreeListRender(treeList, theme) {
  if (treeList.__treexStickyLeftPatched) return;

  treeList.__treexStickyLeftPatched = true;

  treeList.render = function renderStickyLeft(width) {
    const lines = [];

    if (this.filteredNodes.length === 0) {
      lines.push(truncateToWidth(theme.fg("muted", "  No entries found"), width));
      lines.push(truncateToWidth(theme.fg("muted", `  (0/0)${this.getStatusLabels()}`), width));
      return lines;
    }

    const { startIndex, endIndex, stickyLeftShift } = getNestedStickyLeftMetrics(this);

    for (let index = startIndex; index < endIndex; index++) {
      const flatNode = this.filteredNodes[index];
      const entry = flatNode.node.entry;
      const isSelected = index === this.selectedIndex;
      const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
      const displayIndent = Math.max(0, getNestedDisplayIndent(this, flatNode) - stickyLeftShift);
      const shiftedGutters = shiftNestedGutters(flatNode.gutters, stickyLeftShift);
      const connector = flatNode.showConnector && !flatNode.isVirtualRootChild ? (flatNode.isLast ? "└─ " : "├─ ") : "";
      const connectorPosition = connector ? displayIndent - 1 : -1;
      const totalChars = displayIndent * 3;
      const prefixChars = [];
      const isFolded = this.foldedNodes.has(entry.id);

      for (let prefixIndex = 0; prefixIndex < totalChars; prefixIndex++) {
        const level = Math.floor(prefixIndex / 3);
        const posInLevel = prefixIndex % 3;
        const gutter = shiftedGutters.find((gutterInfo) => gutterInfo.position === level);

        if (gutter) {
          if (posInLevel === 0) prefixChars.push(gutter.show ? "│" : " ");
          else prefixChars.push(" ");
        } else if (connector && level === connectorPosition) {
          if (posInLevel === 0) prefixChars.push(flatNode.isLast ? "└" : "├");
          else if (posInLevel === 1) {
            const foldable = this.isFoldable(entry.id);
            prefixChars.push(isFolded ? "⊞" : foldable ? "⊟" : "─");
          } else prefixChars.push(" ");
        } else {
          prefixChars.push(" ");
        }
      }

      const prefix = prefixChars.join("");
      const showsFoldInConnector = flatNode.showConnector && !flatNode.isVirtualRootChild;
      const foldMarker = isFolded && !showsFoldInConnector ? theme.fg("accent", "⊞ ") : "";
      const pathMarker = this.activePathIds.has(entry.id) ? theme.fg("accent", "• ") : "";
      const label = flatNode.node.label ? theme.fg("warning", `[${flatNode.node.label}] `) : "";
      const labelTimestamp =
        this.showLabelTimestamps && flatNode.node.label && flatNode.node.labelTimestamp
          ? theme.fg("muted", `${this.formatLabelTimestamp(flatNode.node.labelTimestamp)} `)
          : "";
      const content = this.getEntryDisplayText(flatNode.node, isSelected);

      let line = cursor + theme.fg("dim", prefix) + foldMarker + pathMarker + label + labelTimestamp + content;
      if (isSelected) line = theme.bg("selectedBg", line);
      lines.push(truncateToWidth(line, width));
    }

    lines.push(truncateToWidth(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredNodes.length})${this.getStatusLabels()}`), width));
    return lines;
  };
}

class TreeState {
  constructor(tree, currentLeafId, initialSelectedId, initialFilterMode = "default") {
    this.flatNodes = [];
    this.filteredNodes = [];
    this.selectedIndex = 0;
    this.currentLeafId = currentLeafId;
    this.filterMode = initialFilterMode;
    this.searchQuery = "";
    this.toolCallMap = new Map();
    this.multipleRoots = tree.length > 1;
    this.lastSelectedId = null;
    this.foldedNodes = new Set();

    this.flatNodes = this.flattenTree(tree);
    this.applyFilter();

    const targetId = initialSelectedId ?? currentLeafId;
    this.selectedIndex = this.findNearestVisibleIndex(targetId);
    this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? null;
  }

  getDisplayDepth(flatNode) {
    const displayIndent = this.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;
    return displayIndent + 1;
  }

  findNearestVisibleIndex(entryId) {
    if (this.filteredNodes.length === 0) return 0;

    const entryMap = new Map();
    for (const flatNode of this.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    const visibleIdToIndex = new Map(this.filteredNodes.map((node, index) => [node.node.entry.id, index]));

    let currentId = entryId ?? null;
    while (currentId !== null) {
      const index = visibleIdToIndex.get(currentId);
      if (index !== undefined) return index;
      const node = entryMap.get(currentId);
      if (!node) break;
      currentId = node.node.entry.parentId ?? null;
    }

    return this.filteredNodes.length - 1;
  }

  flattenTree(roots) {
    const flatNodes = [];
    this.toolCallMap.clear();
    this.multipleRoots = roots.length > 1;

    const containsCurrentLeaf = new Map();
    const allNodes = [];
    const pending = [...roots];

    while (pending.length > 0) {
      const node = pending.pop();
      allNodes.push(node);
      for (let index = node.children.length - 1; index >= 0; index--) {
        pending.push(node.children[index]);
      }
    }

    for (let index = allNodes.length - 1; index >= 0; index--) {
      const node = allNodes[index];
      let hasCurrentLeaf = node.entry.id === this.currentLeafId;
      for (const child of node.children) {
        if (containsCurrentLeaf.get(child)) hasCurrentLeaf = true;
      }
      containsCurrentLeaf.set(node, hasCurrentLeaf);
    }

    const stack = [];
    const sortedRoots = [...roots].sort((a, b) => Number(containsCurrentLeaf.get(b)) - Number(containsCurrentLeaf.get(a)));

    for (let index = sortedRoots.length - 1; index >= 0; index--) {
      stack.push({
        node: sortedRoots[index],
        indent: this.multipleRoots ? 1 : 0,
        justBranched: this.multipleRoots,
        showConnector: this.multipleRoots,
        isLast: index === sortedRoots.length - 1,
        gutters: [],
        isVirtualRootChild: this.multipleRoots,
      });
    }

    while (stack.length > 0) {
      const { node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild } = stack.pop();
      const entry = node.entry;

      if (entry.type === "message" && entry.message.role === "assistant" && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block && typeof block === "object" && block.type === "toolCall") {
            this.toolCallMap.set(block.id, { name: block.name, arguments: block.arguments });
          }
        }
      }

      flatNodes.push({ node, indent, showConnector, isLast, gutters, isVirtualRootChild });

      const children = [...node.children].sort((a, b) => Number(containsCurrentLeaf.get(b)) - Number(containsCurrentLeaf.get(a)));
      const childCount = children.length;
      const childIndent = childCount > 1 || (justBranched && indent > 0) ? indent + 1 : indent;
      const currentDisplayIndent = this.multipleRoots ? Math.max(0, indent - 1) : indent;
      const childGutters = showConnector && !isVirtualRootChild
        ? [...gutters, { position: Math.max(0, currentDisplayIndent - 1), show: !isLast }]
        : gutters;

      for (let index = childCount - 1; index >= 0; index--) {
        stack.push({
          node: children[index],
          indent: childIndent,
          justBranched: childCount > 1,
          showConnector: childCount > 1,
          isLast: index === childCount - 1,
          gutters: childGutters,
          isVirtualRootChild: false,
        });
      }
    }

    return flatNodes;
  }

  applyFilter() {
    if (this.filteredNodes.length > 0) {
      this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? this.lastSelectedId;
    }

    const searchTokens = this.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);

    this.filteredNodes = this.flatNodes.filter((flatNode) => {
      const entry = flatNode.node.entry;
      const isCurrentLeaf = entry.id === this.currentLeafId;

      if (entry.type === "message" && entry.message.role === "assistant" && !isCurrentLeaf) {
        const hasText = this.hasTextContent(entry.message.content);
        const isErrorOrAborted =
          entry.message.stopReason && entry.message.stopReason !== "stop" && entry.message.stopReason !== "toolUse";
        if (!hasText && !isErrorOrAborted) return false;
      }

      const isSettingsEntry =
        entry.type === "label" ||
        entry.type === "custom" ||
        entry.type === "model_change" ||
        entry.type === "thinking_level_change" ||
        entry.type === "session_info";

      let passesFilter = true;
      switch (this.filterMode) {
        case "user-only":
          passesFilter = entry.type === "message" && entry.message.role === "user";
          break;
        case "no-tools":
          passesFilter = !isSettingsEntry && !(entry.type === "message" && entry.message.role === "toolResult");
          break;
        case "labeled-only":
          passesFilter = flatNode.node.label !== undefined;
          break;
        case "all":
          passesFilter = true;
          break;
        default:
          passesFilter = !isSettingsEntry;
          break;
      }

      if (!passesFilter) return false;

      if (searchTokens.length > 0) {
        const searchable = this.getSearchableText(flatNode.node).toLowerCase();
        return searchTokens.every((token) => searchable.includes(token));
      }

      return true;
    });

    if (this.foldedNodes.size > 0) {
      const skipSet = new Set();
      for (const flatNode of this.flatNodes) {
        const { id, parentId } = flatNode.node.entry;
        if (parentId != null && (this.foldedNodes.has(parentId) || skipSet.has(parentId))) {
          skipSet.add(id);
        }
      }
      this.filteredNodes = this.filteredNodes.filter((flatNode) => !skipSet.has(flatNode.node.entry.id));
    }

    this.recalculateVisualStructure();

    if (this.lastSelectedId) {
      this.selectedIndex = this.findNearestVisibleIndex(this.lastSelectedId);
    } else if (this.selectedIndex >= this.filteredNodes.length) {
      this.selectedIndex = Math.max(0, this.filteredNodes.length - 1);
    }

    if (this.filteredNodes.length > 0) {
      this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? this.lastSelectedId;
    }
  }

  recalculateVisualStructure() {
    if (this.filteredNodes.length === 0) {
      this.multipleRoots = false;
      return;
    }

    const visibleIds = new Set(this.filteredNodes.map((node) => node.node.entry.id));
    const parentById = new Map();
    for (const flatNode of this.flatNodes) {
      parentById.set(flatNode.node.entry.id, flatNode.node.entry.parentId ?? null);
    }

    const getVisibleParentId = (nodeId) => {
      let currentId = parentById.get(nodeId) ?? null;
      while (currentId !== null) {
        if (visibleIds.has(currentId)) return currentId;
        currentId = parentById.get(currentId) ?? null;
      }
      return null;
    };

    const childrenByParentId = new Map([[null, []]]);
    for (const flatNode of this.filteredNodes) {
      const nodeId = flatNode.node.entry.id;
      const parentId = getVisibleParentId(nodeId);
      if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
      childrenByParentId.get(parentId).push(nodeId);
    }

    const rootIds = childrenByParentId.get(null);
    this.multipleRoots = rootIds.length > 1;

    const flatNodesById = new Map();
    for (const flatNode of this.filteredNodes) {
      flatNodesById.set(flatNode.node.entry.id, flatNode);
    }

    const stack = [];
    for (let index = rootIds.length - 1; index >= 0; index--) {
      stack.push({
        nodeId: rootIds[index],
        indent: this.multipleRoots ? 1 : 0,
        justBranched: this.multipleRoots,
        showConnector: this.multipleRoots,
        isLast: index === rootIds.length - 1,
        gutters: [],
        isVirtualRootChild: this.multipleRoots,
      });
    }

    while (stack.length > 0) {
      const { nodeId, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild } = stack.pop();
      const flatNode = flatNodesById.get(nodeId);
      if (!flatNode) continue;

      flatNode.indent = indent;
      flatNode.showConnector = showConnector;
      flatNode.isLast = isLast;
      flatNode.gutters = gutters;
      flatNode.isVirtualRootChild = isVirtualRootChild;

      const childIds = childrenByParentId.get(nodeId) ?? [];
      const childCount = childIds.length;
      const childIndent = childCount > 1 || (justBranched && indent > 0) ? indent + 1 : indent;
      const currentDisplayIndent = this.multipleRoots ? Math.max(0, indent - 1) : indent;
      const childGutters = showConnector && !isVirtualRootChild
        ? [...gutters, { position: Math.max(0, currentDisplayIndent - 1), show: !isLast }]
        : gutters;

      for (let index = childCount - 1; index >= 0; index--) {
        stack.push({
          nodeId: childIds[index],
          indent: childIndent,
          justBranched: childCount > 1,
          showConnector: childCount > 1,
          isLast: index === childCount - 1,
          gutters: childGutters,
          isVirtualRootChild: false,
        });
      }
    }
  }

  getSearchableText(node) {
    const entry = node.entry;
    const parts = [];

    if (node.label) parts.push(node.label);

    switch (entry.type) {
      case "message": {
        parts.push(entry.message.role);
        parts.push(this.extractContent(entry.message.content, { includeToolCalls: true }));
        if (entry.message.role === "bashExecution" && entry.message.command) parts.push(entry.message.command);
        if (entry.message.errorMessage) parts.push(entry.message.errorMessage);
        break;
      }
      case "custom_message":
        parts.push(entry.customType);
        parts.push(this.extractContent(entry.content, { includeToolCalls: true }));
        break;
      case "compaction":
        parts.push("compaction", entry.summary ?? "");
        break;
      case "branch_summary":
        parts.push("branch summary", entry.summary ?? "");
        break;
      case "session_info":
        parts.push("title", entry.name ?? "");
        break;
      case "model_change":
        parts.push("model", entry.modelId ?? "");
        break;
      case "thinking_level_change":
        parts.push("thinking", entry.thinkingLevel ?? "");
        break;
      case "custom":
        parts.push("custom", entry.customType ?? "", safeJson(entry.data));
        break;
      case "label":
        parts.push("label", entry.label ?? "");
        break;
      default:
        break;
    }

    return parts.join(" ");
  }

  updateNodeLabel(entryId, label, labelTimestamp = new Date().toISOString()) {
    for (const flatNode of this.flatNodes) {
      if (flatNode.node.entry.id === entryId) {
        flatNode.node.label = label;
        flatNode.node.labelTimestamp = label ? labelTimestamp : undefined;
        break;
      }
    }
    this.applyFilter();
  }

  describeEntry(node) {
    const entry = node.entry;

    switch (entry.type) {
      case "message": {
        const message = entry.message;

        if (message.role === "user") {
          return {
            kind: "USER",
            full: this.extractContent(message.content, { includeToolCalls: true }) || "(empty)",
            toolName: undefined,
          };
        }

        if (message.role === "assistant") {
          return {
            kind: "ASSISTANT",
            full:
              this.extractContent(message.content, { includeToolCalls: true, verboseToolCalls: true }) ||
              message.errorMessage ||
              (message.stopReason === "aborted" ? "(aborted)" : "(no content)"),
            toolName: undefined,
          };
        }

        if (message.role === "toolResult") {
          const toolCall = message.toolCallId ? this.toolCallMap.get(message.toolCallId) : undefined;
          const toolName = message.toolName ?? toolCall?.name;
          return {
            kind: "TOOL RESULT",
            full:
              this.extractContent(message.content, { includeToolCalls: true, verboseToolCalls: true }) ||
              (toolCall ? this.formatToolCallVerbose(toolCall.name, toolCall.arguments) : `[${toolName ?? "tool"}]`),
            toolName,
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
          toolName: undefined,
        };
      }

      case "custom_message":
        return {
          kind: entry.customType ? `${entry.customType}`.toUpperCase() : "CUSTOM MESSAGE",
          full: this.extractContent(entry.content, { includeToolCalls: true }) || "(empty)",
          toolName: undefined,
        };

      case "compaction": {
        const tokenCount = Math.round((entry.tokensBefore ?? 0) / 1000);
        const label = `[compaction: ${tokenCount}k tokens]`;
        return {
          kind: "COMPACTION",
          full: normalizeDetail(entry.summary ?? label) || label,
          toolName: undefined,
        };
      }

      case "branch_summary":
        return {
          kind: "BRANCH SUMMARY",
          full: normalizeDetail(entry.summary ?? "") || "(empty)",
          toolName: undefined,
        };

      case "model_change":
        return {
          kind: "MODEL",
          full: `[model: ${entry.modelId}]`,
          toolName: undefined,
        };

      case "thinking_level_change":
        return {
          kind: "THINKING",
          full: `[thinking: ${entry.thinkingLevel}]`,
          toolName: undefined,
        };

      case "custom":
        return {
          kind: entry.customType ? `${entry.customType}`.toUpperCase() : "CUSTOM",
          full: entry.data === undefined ? `[custom: ${entry.customType}]` : safeJson(entry.data, 2),
          toolName: undefined,
        };

      case "label":
        return {
          kind: "LABEL",
          full: entry.label ?? "(cleared)",
          toolName: undefined,
        };

      case "session_info":
        return {
          kind: "SESSION TITLE",
          full: entry.name ?? "(empty)",
          toolName: undefined,
        };

      default:
        return {
          kind: "ENTRY",
          full: "[entry]",
          toolName: undefined,
        };
    }
  }

  extractContent(content, options = {}) {
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
      } else if (block.type === "toolCall" && includeToolCalls) {
        parts.push(
          verboseToolCalls
            ? this.formatToolCallVerbose(block.name, block.arguments)
            : this.formatToolCall(block.name, block.arguments),
        );
      } else if (block.type === "image") {
        parts.push("[image]");
      }
    }

    return parts.filter(Boolean).join("\n\n");
  }

  hasTextContent(content) {
    if (typeof content === "string") return content.trim().length > 0;
    if (!Array.isArray(content)) return false;

    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text" && block.text?.trim()) {
        return true;
      }
    }

    return false;
  }

  formatToolCall(name, args) {
    const shortenPath = (value) => {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const text = String(value ?? "");
      if (home && text.startsWith(home)) return `~${text.slice(home.length)}`;
      return text;
    };

    switch (name) {
      case "read": {
        const filePath = shortenPath(args.path || args.file_path || "");
        const offset = args.offset;
        const limit = args.limit;
        let display = filePath;
        if (offset !== undefined || limit !== undefined) {
          const start = offset ?? 1;
          const end = limit !== undefined ? start + limit - 1 : "";
          display += `:${start}${end ? `-${end}` : ""}`;
        }
        return `[read: ${display}]`;
      }
      case "write":
        return `[write: ${shortenPath(args.path || args.file_path || "")}]`;
      case "edit":
        return `[edit: ${shortenPath(args.path || args.file_path || "")}]`;
      case "bash": {
        const rawCommand = String(args.command || "");
        const command = rawCommand.replace(/[\n\t]/g, " ").trim().slice(0, 50);
        return `[bash: ${command}${rawCommand.length > 50 ? "..." : ""}]`;
      }
      case "grep":
        return `[grep: /${String(args.pattern || "")}/ in ${shortenPath(args.path || ".")}]`;
      case "find":
        return `[find: ${String(args.pattern || "")} in ${shortenPath(args.path || ".")}]`;
      case "ls":
        return `[ls: ${shortenPath(args.path || ".")}]`;
      default: {
        const argsJson = safeJson(args);
        return `[${name}: ${argsJson.slice(0, 40)}${argsJson.length > 40 ? "..." : ""}]`;
      }
    }
  }

  formatToolCallVerbose(name, args) {
    const json = safeJson(args, 2);
    return json ? `${name}\n${json}` : name;
  }

}

export class TreeXComponent {
  constructor(options) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.done = options.done;
    this.onLabelChange = options.onLabelChange ?? (() => {});
    this.tree = options.tree;
    this.currentLeafId = options.currentLeafId;
    this._focused = false;

    this.treeState = new TreeState(this.tree, this.currentLeafId, options.initialSelectedId, options.initialFilterMode);
    this.nestedSelector = this.createNestedSelector(options.initialSelectedId, options.initialFilterMode);
  }

  getNestedTerminalHeight() {
    const detailPaneLines = DETAIL_BODY_LINES + 2;
    const visibleRows = Math.max(5, Math.floor(this.tui.terminal.rows / 2) - detailPaneLines);
    return visibleRows * 2;
  }

  createNestedSelector(initialSelectedId, initialFilterMode) {
    const selector = new UpstreamTreeSelectorComponent(
      this.tree,
      this.currentLeafId,
      this.getNestedTerminalHeight(),
      (entryId) => this.done({ type: "select", entryId }),
      () => this.done(undefined),
      (entryId, label) => this.applySharedLabelChange(entryId, label),
      initialSelectedId,
      initialFilterMode,
    );

    patchNestedTreeListRender(selector.getTreeList(), this.theme);
    selector.focused = this._focused;
    this.lastNestedTerminalHeight = this.getNestedTerminalHeight();
    return selector;
  }

  getNestedTreeList() {
    return this.nestedSelector.getTreeList();
  }

  captureViewState() {
    const treeList = this.getNestedTreeList();
    return {
      selectedId: treeList.getSelectedNode()?.entry?.id,
      filterMode: treeList.filterMode,
      searchQuery: treeList.searchQuery,
      showLabelTimestamps: treeList.showLabelTimestamps,
    };
  }

  restoreViewState(viewState) {
    const treeList = this.getNestedTreeList();
    treeList.searchQuery = viewState.searchQuery;
    treeList.showLabelTimestamps = viewState.showLabelTimestamps;
    treeList.applyFilter();
  }

  ensureNestedSelector() {
    if (this.lastNestedTerminalHeight === this.getNestedTerminalHeight()) {
      return;
    }

    const viewState = this.captureViewState();
    this.nestedSelector = this.createNestedSelector(viewState.selectedId, viewState.filterMode);
    this.restoreViewState(viewState);
  }

  applySharedLabelChange(entryId, label) {
    const labelTimestamp = label ? new Date().toISOString() : undefined;
    updateTreeNodeLabel(this.tree, entryId, label, labelTimestamp);
    this.treeState.updateNodeLabel(entryId, label, labelTimestamp);
    this.getNestedTreeList().updateNodeLabel(entryId, label, labelTimestamp);
    this.onLabelChange(entryId, label);
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.nestedSelector.focused = value;
  }

  invalidate() {
    this.nestedSelector.invalidate();
  }

  handleInput(keyData) {
    this.ensureNestedSelector();
    this.nestedSelector.handleInput(keyData);
    this.tui.requestRender();
  }

  getTitle(width) {
    return fitLine(this.theme.bold(this.theme.fg("accent", "TreeX")), width);
  }

  getHelpLine(width) {
    const help = `  ↑/↓: move. ←/→: page. ^←/^→ or Alt+←/Alt+→: fold/branch. ${upstreamKeyText("app.tree.editLabel")}: label. ^D/^T/^U/^L/^A: filters (^O/⇧^O cycle). ${upstreamKeyText("app.tree.toggleLabelTimestamp")}: label time`;
    return fitLine(this.theme.fg("muted", help), width);
  }

  getSearchLine(width, query = "") {
    const prefix = this.theme.fg("muted", "Type to search:");
    const suffix = query ? ` ${this.theme.fg("accent", query)}` : "";
    return fitLine(`${prefix}${suffix}`, width);
  }

  getStickyLeftLine(width, stickyLeftDepth) {
    if (!stickyLeftDepth) {
      return fitLine("", width);
    }

    const badge = this.theme.bg(
      "selectedBg",
      ` ${this.theme.bold(this.theme.fg("accent", "⇤"))} ${this.theme.bold(this.theme.fg("accent", `depth ${stickyLeftDepth}`))} `,
    );

    return fitLine(`  ${badge}`, width);
  }

  renderDetailPane(width) {
    const selectedNodeId = this.getNestedTreeList().getSelectedNode()?.entry?.id;
    const selected = this.treeState.flatNodes.find((flatNode) => flatNode.node.entry.id === selectedNodeId);
    const maxBodyLines = DETAIL_BODY_LINES;

    if (!selected) {
      return [
        fitLine(this.theme.fg("muted", "NO SELECTION"), width),
        ...Array.from({ length: maxBodyLines }, () => fitLine("", width)),
        fitLine(this.theme.fg("border", "─".repeat(width)), width),
      ];
    }

    const info = this.treeState.describeEntry(selected.node);
    const metadataParts = [
      this.theme.bold(this.theme.fg("accent", `DEPTH ${this.treeState.getDisplayDepth(selected)}`)),
      this.theme.bold(info.kind),
      this.theme.fg("muted", formatRelativeTime(selected.node.entry.timestamp)),
    ];

    if (info.toolName) metadataParts.push(this.theme.fg("muted", String(info.toolName).toUpperCase()));
    if (selected.node.label) metadataParts.push(this.theme.fg("warning", `[${selected.node.label}]`));
    if (selected.node.entry.id === this.currentLeafId) metadataParts.push(this.theme.fg("accent", "CURRENT"));

    const fullText = normalizeDetail(info.full || "") || "(no text)";
    const wrappedLines = wrapTextWithAnsi(fullText, width);
    const bodyLines = wrappedLines.slice(0, maxBodyLines);

    if (wrappedLines.length > maxBodyLines && bodyLines.length > 0) {
      const lastLine = bodyLines.length - 1;
      bodyLines[lastLine] = truncateToWidth(bodyLines[lastLine], Math.max(1, width - 1), "") + this.theme.fg("muted", "…");
    }

    while (bodyLines.length < maxBodyLines) {
      bodyLines.push("");
    }

    return [
      fitLine(metadataParts.join(this.theme.fg("muted", " · ")), width),
      ...bodyLines.map((line) => fitLine(line, width)),
      fitLine(this.theme.fg("border", "─".repeat(width)), width),
    ];
  }

  render(width) {
    const safeWidth = Math.max(20, width);

    this.ensureNestedSelector();
    const treeList = this.getNestedTreeList();
    const { stickyLeftDepth } = getNestedStickyLeftMetrics(treeList);
    const lines = [...this.nestedSelector.render(safeWidth)];

    lines[2] = this.getTitle(safeWidth);
    lines[3] = this.getHelpLine(safeWidth);
    lines[4] = this.getSearchLine(safeWidth, treeList.getSearchQuery());
    lines[6] = this.getStickyLeftLine(safeWidth, stickyLeftDepth);

    return [...lines, ...this.renderDetailPane(safeWidth)];
  }
}
