import {
  CURSOR_MARKER,
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { cycleViewMode, formatViewMode, getTreeStyleLabel } from "./config.js";
import { TreeSelectorComponent as UpstreamTreeSelectorComponent } from "../vendor/pi/modes/interactive/components/tree-selector.js";
import { keyText as upstreamKeyText } from "../vendor/pi/modes/interactive/components/keybinding-hints.js";

const FILTER_MODES = ["default", "no-tools", "user-only", "labeled-only", "all"];

function normalizePreview(text) {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function formatKeys(keybindings, keybinding) {
  const keys = keybindings.getKeys(keybinding);
  return keys.length === 0 ? "" : keys.join("/");
}

function fitLine(line, width, theme, isSelected = false) {
  const truncated = truncateToWidth(line, width);
  const padded = truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  return isSelected ? theme.bg("selectedBg", padded) : padded;
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

class TreeState {
  constructor(tree, currentLeafId, maxVisibleLines, initialSelectedId, initialFilterMode = "default") {
    this.flatNodes = [];
    this.filteredNodes = [];
    this.selectedIndex = 0;
    this.currentLeafId = currentLeafId;
    this.maxVisibleLines = maxVisibleLines;
    this.filterMode = initialFilterMode;
    this.searchQuery = "";
    this.toolCallMap = new Map();
    this.multipleRoots = tree.length > 1;
    this.showLabelTimestamps = false;
    this.activePathIds = new Set();
    this.visibleParentMap = new Map();
    this.visibleChildrenMap = new Map();
    this.lastSelectedId = null;
    this.foldedNodes = new Set();
    this.onSelect = undefined;
    this.onCancel = undefined;
    this.onLabelEdit = undefined;

    this.flatNodes = this.flattenTree(tree);
    this.buildActivePath();
    this.applyFilter();

    const targetId = initialSelectedId ?? currentLeafId;
    this.selectedIndex = this.findNearestVisibleIndex(targetId);
    this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? null;
  }

  setMaxVisibleLines(value) {
    this.maxVisibleLines = Math.max(5, value);
  }

  getSelectedFlatNode() {
    return this.filteredNodes[this.selectedIndex];
  }

  getSelectedNode() {
    return this.getSelectedFlatNode()?.node;
  }

  getSelectedEntryId() {
    return this.getSelectedFlatNode()?.node.entry.id;
  }

  getSearchQuery() {
    return this.searchQuery;
  }

  getDisplayDepth(flatNode) {
    const displayIndent = this.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;
    return displayIndent + 1;
  }

  getMaxDepthDigits() {
    return Math.max(1, ...this.flatNodes.map((node) => String(this.getDisplayDepth(node)).length));
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

  buildActivePath() {
    this.activePathIds.clear();
    if (!this.currentLeafId) return;

    const entryMap = new Map();
    for (const flatNode of this.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    let currentId = this.currentLeafId;
    while (currentId) {
      this.activePathIds.add(currentId);
      const node = entryMap.get(currentId);
      if (!node) break;
      currentId = node.node.entry.parentId ?? null;
    }
  }

  flattenTree(roots) {
    const result = [];
    this.toolCallMap.clear();

    const containsActive = new Map();
    const leafId = this.currentLeafId;
    const allNodes = [];
    const preOrderStack = [...roots];

    while (preOrderStack.length > 0) {
      const node = preOrderStack.pop();
      allNodes.push(node);
      for (let index = node.children.length - 1; index >= 0; index--) {
        preOrderStack.push(node.children[index]);
      }
    }

    for (let index = allNodes.length - 1; index >= 0; index--) {
      const node = allNodes[index];
      let hasActive = leafId !== null && node.entry.id === leafId;
      for (const child of node.children) {
        if (containsActive.get(child)) hasActive = true;
      }
      containsActive.set(node, hasActive);
    }

    const stack = [];
    const multipleRoots = roots.length > 1;
    const orderedRoots = [...roots].sort((a, b) => Number(containsActive.get(b)) - Number(containsActive.get(a)));

    for (let index = orderedRoots.length - 1; index >= 0; index--) {
      const isLast = index === orderedRoots.length - 1;
      stack.push([
        orderedRoots[index],
        1,
        multipleRoots ? 1 : 0,
        multipleRoots,
        multipleRoots,
        isLast,
        [],
        multipleRoots,
      ]);
    }

    while (stack.length > 0) {
      const [node, depth, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] = stack.pop();
      const entry = node.entry;

      if (entry.type === "message" && entry.message.role === "assistant") {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && block.type === "toolCall") {
              this.toolCallMap.set(block.id, { name: block.name, arguments: block.arguments });
            }
          }
        }
      }

      result.push({ node, depth, indent, showConnector, isLast, gutters, isVirtualRootChild });

      const children = node.children;
      const multipleChildren = children.length > 1;
      const orderedChildren = [...children].sort((a, b) => Number(containsActive.get(b)) - Number(containsActive.get(a)));

      let childIndent;
      if (multipleChildren) childIndent = indent + 1;
      else if (justBranched && indent > 0) childIndent = indent + 1;
      else childIndent = indent;

      const connectorDisplayed = showConnector && !isVirtualRootChild;
      const currentDisplayIndent = this.multipleRoots ? Math.max(0, indent - 1) : indent;
      const connectorPosition = Math.max(0, currentDisplayIndent - 1);
      const childGutters = connectorDisplayed
        ? [...gutters, { position: connectorPosition, show: !isLast }]
        : gutters;

      for (let index = orderedChildren.length - 1; index >= 0; index--) {
        const childIsLast = index === orderedChildren.length - 1;
        stack.push([
          orderedChildren[index],
          depth + 1,
          childIndent,
          multipleChildren,
          multipleChildren,
          childIsLast,
          childGutters,
          false,
        ]);
      }
    }

    return result;
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
    if (this.filteredNodes.length === 0) return;

    const visibleIds = new Set(this.filteredNodes.map((node) => node.node.entry.id));
    const entryMap = new Map();
    for (const flatNode of this.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    const findVisibleAncestor = (nodeId) => {
      let currentId = entryMap.get(nodeId)?.node.entry.parentId ?? null;
      while (currentId !== null) {
        if (visibleIds.has(currentId)) return currentId;
        currentId = entryMap.get(currentId)?.node.entry.parentId ?? null;
      }
      return null;
    };

    const visibleParent = new Map();
    const visibleChildren = new Map();
    visibleChildren.set(null, []);

    for (const flatNode of this.filteredNodes) {
      const nodeId = flatNode.node.entry.id;
      const ancestorId = findVisibleAncestor(nodeId);
      visibleParent.set(nodeId, ancestorId);
      if (!visibleChildren.has(ancestorId)) visibleChildren.set(ancestorId, []);
      visibleChildren.get(ancestorId).push(nodeId);
    }

    const visibleRootIds = visibleChildren.get(null) ?? [];
    this.multipleRoots = visibleRootIds.length > 1;

    const filteredNodeMap = new Map();
    for (const flatNode of this.filteredNodes) {
      filteredNodeMap.set(flatNode.node.entry.id, flatNode);
    }

    const stack = [];
    for (let index = visibleRootIds.length - 1; index >= 0; index--) {
      const isLast = index === visibleRootIds.length - 1;
      stack.push([
        visibleRootIds[index],
        this.multipleRoots ? 1 : 0,
        this.multipleRoots,
        this.multipleRoots,
        isLast,
        [],
        this.multipleRoots,
      ]);
    }

    while (stack.length > 0) {
      const [nodeId, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] = stack.pop();
      const flatNode = filteredNodeMap.get(nodeId);
      if (!flatNode) continue;

      flatNode.indent = indent;
      flatNode.showConnector = showConnector;
      flatNode.isLast = isLast;
      flatNode.gutters = gutters;
      flatNode.isVirtualRootChild = isVirtualRootChild;

      const children = visibleChildren.get(nodeId) || [];
      const multipleChildren = children.length > 1;

      let childIndent;
      if (multipleChildren) childIndent = indent + 1;
      else if (justBranched && indent > 0) childIndent = indent + 1;
      else childIndent = indent;

      const connectorDisplayed = showConnector && !isVirtualRootChild;
      const currentDisplayIndent = this.multipleRoots ? Math.max(0, indent - 1) : indent;
      const connectorPosition = Math.max(0, currentDisplayIndent - 1);
      const childGutters = connectorDisplayed
        ? [...gutters, { position: connectorPosition, show: !isLast }]
        : gutters;

      for (let index = children.length - 1; index >= 0; index--) {
        const childIsLast = index === children.length - 1;
        stack.push([children[index], childIndent, multipleChildren, multipleChildren, childIsLast, childGutters, false]);
      }
    }

    this.visibleParentMap = visibleParent;
    this.visibleChildrenMap = visibleChildren;
  }

  getSearchableText(node) {
    const entry = node.entry;
    const parts = [];

    if (node.label) parts.push(node.label);

    switch (entry.type) {
      case "message": {
        parts.push(entry.message.role);
        parts.push(this.extractContent(entry.message.content, { preview: false, includeToolCalls: true }));
        if (entry.message.role === "bashExecution" && entry.message.command) parts.push(entry.message.command);
        if (entry.message.errorMessage) parts.push(entry.message.errorMessage);
        break;
      }
      case "custom_message":
        parts.push(entry.customType);
        parts.push(this.extractContent(entry.content, { preview: false, includeToolCalls: true }));
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

  getStatusLabels() {
    let labels = "";
    switch (this.filterMode) {
      case "no-tools":
        labels += " [no-tools]";
        break;
      case "user-only":
        labels += " [user]";
        break;
      case "labeled-only":
        labels += " [labeled]";
        break;
      case "all":
        labels += " [all]";
        break;
      default:
        break;
    }

    if (this.showLabelTimestamps) labels += " [+label time]";
    return labels;
  }

  renderRows(width, treeStyle, theme) {
    const lines = [];

    if (this.filteredNodes.length === 0) {
      lines.push(fitLine(theme.fg("muted", "No entries found"), width, theme));
      lines.push(fitLine(theme.fg("muted", `(0/0)${this.getStatusLabels()}`), width, theme));
      return lines;
    }

    const visibleWindow = Math.max(1, this.maxVisibleLines - 1);
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(visibleWindow / 2),
        Math.max(0, this.filteredNodes.length - visibleWindow),
      ),
    );
    const endIndex = Math.min(startIndex + visibleWindow, this.filteredNodes.length);

    for (let index = startIndex; index < endIndex; index++) {
      const flatNode = this.filteredNodes[index];
      lines.push(this.renderRow(flatNode, index === this.selectedIndex, width, treeStyle, theme));
    }

    lines.push(
      fitLine(
        theme.fg("muted", `(${this.selectedIndex + 1}/${this.filteredNodes.length})${this.getStatusLabels()}`),
        width,
        theme,
      ),
    );

    return lines;
  }

  renderRow(flatNode, isSelected, width, treeStyle, theme) {
    const info = this.describeEntry(flatNode.node, theme, isSelected);
    const isCurrentLeaf = flatNode.node.entry.id === this.currentLeafId;
    const isOnActivePath = this.activePathIds.has(flatNode.node.entry.id);
    const label = flatNode.node.label ? theme.fg("warning", `[${flatNode.node.label}] `) : "";
    const labelTimestamp =
      this.showLabelTimestamps && flatNode.node.label && flatNode.node.labelTimestamp
        ? theme.fg("muted", `${this.formatLabelTimestamp(flatNode.node.labelTimestamp)} `)
        : "";
    const activeBadge = isCurrentLeaf ? theme.fg("accent", " ← active") : "";

    let line;
    if (treeStyle === "rail") {
      const depthDigits = this.getMaxDepthDigits();
      const gutterText = String(this.getDisplayDepth(flatNode)).padStart(depthDigits, " ");
      const gutter = isSelected ? theme.fg("accent", gutterText) : theme.fg("muted", gutterText);
      const indicatorChar = this.foldedNodes.has(flatNode.node.entry.id) ? "▸" : isOnActivePath ? "•" : " ";
      const indicator = indicatorChar === " " ? "  " : `${theme.fg("accent", indicatorChar)} `;
      line = `${gutter} ${indicator}${label}${labelTimestamp}${info.preview}${activeBadge}`;
    } else {
      const displayIndent = this.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;
      const connector = flatNode.showConnector && !flatNode.isVirtualRootChild ? (flatNode.isLast ? "└─ " : "├─ ") : "";
      const connectorPosition = connector ? displayIndent - 1 : -1;
      const totalChars = displayIndent * 3;
      const prefixChars = [];
      const isFolded = this.foldedNodes.has(flatNode.node.entry.id);

      for (let index = 0; index < totalChars; index++) {
        const level = Math.floor(index / 3);
        const posInLevel = index % 3;
        const gutter = flatNode.gutters.find((gutterInfo) => gutterInfo.position === level);

        if (gutter) {
          if (posInLevel === 0) prefixChars.push(gutter.show ? "│" : " ");
          else prefixChars.push(" ");
        } else if (connector && level === connectorPosition) {
          if (posInLevel === 0) prefixChars.push(flatNode.isLast ? "└" : "├");
          else if (posInLevel === 1) {
            const foldable = this.isFoldable(flatNode.node.entry.id);
            prefixChars.push(isFolded ? "⊞" : foldable ? "⊟" : "─");
          } else prefixChars.push(" ");
        } else {
          prefixChars.push(" ");
        }
      }

      const prefix = prefixChars.join("");
      const showsFoldInConnector = flatNode.showConnector && !flatNode.isVirtualRootChild;
      const foldMarker = isFolded && !showsFoldInConnector ? theme.fg("accent", "⊞ ") : "";
      const pathMarker = isOnActivePath ? theme.fg("accent", "• ") : "";
      line = `${theme.fg("dim", prefix)}${foldMarker}${pathMarker}${label}${labelTimestamp}${info.preview}${activeBadge}`;
    }

    return fitLine(line, width, theme, isSelected);
  }

  describeEntry(node, theme, isSelected = false) {
    const entry = node.entry;
    const emphasize = (text) => (isSelected ? theme.bold(text) : text);

    switch (entry.type) {
      case "message": {
        const message = entry.message;

        if (message.role === "user") {
          const full = this.extractContent(message.content, { preview: false, includeToolCalls: true }) || "(empty)";
          const previewText = normalizePreview(full) || "(empty)";
          return {
            kind: "USER",
            preview: emphasize(`${theme.fg("accent", "user: ")}${previewText}`),
            full,
            toolName: undefined,
          };
        }

        if (message.role === "assistant") {
          const full =
            this.extractContent(message.content, { preview: false, includeToolCalls: true, verboseToolCalls: true }) ||
            message.errorMessage ||
            (message.stopReason === "aborted" ? "(aborted)" : "(no content)");
          const previewText = this.extractContent(message.content, { preview: true, includeToolCalls: false });

          if (previewText) {
            return {
              kind: "ASSISTANT",
              preview: emphasize(`${theme.fg("success", "assistant: ")}${previewText}`),
              full,
              toolName: undefined,
            };
          }

          if (message.stopReason === "aborted") {
            return {
              kind: "ASSISTANT",
              preview: emphasize(`${theme.fg("success", "assistant: ")}${theme.fg("muted", "(aborted)")}`),
              full,
              toolName: undefined,
            };
          }

          if (message.errorMessage) {
            return {
              kind: "ASSISTANT",
              preview: emphasize(`${theme.fg("success", "assistant: ")}${theme.fg("error", normalizePreview(message.errorMessage).slice(0, 120))}`),
              full,
              toolName: undefined,
            };
          }

          return {
            kind: "ASSISTANT",
            preview: emphasize(`${theme.fg("success", "assistant: ")}${theme.fg("muted", "(tool calls)")}`),
            full,
            toolName: undefined,
          };
        }

        if (message.role === "toolResult") {
          const toolCall = message.toolCallId ? this.toolCallMap.get(message.toolCallId) : undefined;
          const toolName = message.toolName ?? toolCall?.name;
          const full =
            this.extractContent(message.content, { preview: false, includeToolCalls: true, verboseToolCalls: true }) ||
            (toolCall ? this.formatToolCallVerbose(toolCall.name, toolCall.arguments) : `[${toolName ?? "tool"}]`);

          let preview;
          if (toolCall) preview = theme.fg("muted", this.formatToolCall(toolCall.name, toolCall.arguments));
          else if (toolName) preview = theme.fg("muted", `[${toolName}]`);
          else preview = theme.fg("muted", `[tool result]`);

          return {
            kind: "TOOL RESULT",
            preview: emphasize(preview),
            full,
            toolName,
          };
        }

        if (message.role === "bashExecution") {
          const full = normalizeDetail(message.command ?? "") || "(empty)";
          return {
            kind: "BASH",
            preview: emphasize(theme.fg("dim", `[bash]: ${normalizePreview(full)}`)),
            full,
            toolName: "bash",
          };
        }

        return {
          kind: String(message.role ?? "MESSAGE").toUpperCase(),
          preview: emphasize(theme.fg("dim", `[${message.role ?? "message"}]`)),
          full: `[${message.role ?? "message"}]`,
          toolName: undefined,
        };
      }

      case "custom_message": {
        const full = this.extractContent(entry.content, { preview: false, includeToolCalls: true }) || "(empty)";
        const previewText = normalizePreview(full) || "(empty)";
        return {
          kind: entry.customType ? `${entry.customType}`.toUpperCase() : "CUSTOM MESSAGE",
          preview: emphasize(`${theme.fg("customMessageLabel", `[${entry.customType}]: `)}${previewText}`),
          full,
          toolName: undefined,
        };
      }

      case "compaction": {
        const tokenCount = Math.round((entry.tokensBefore ?? 0) / 1000);
        const label = `[compaction: ${tokenCount}k tokens]`;
        return {
          kind: "COMPACTION",
          preview: emphasize(theme.fg("warning", label)),
          full: normalizeDetail(entry.summary ?? label) || label,
          toolName: undefined,
        };
      }

      case "branch_summary":
        return {
          kind: "BRANCH SUMMARY",
          preview: emphasize(`${theme.fg("warning", "[branch summary]: ")}${normalizePreview(entry.summary ?? "")}`),
          full: normalizeDetail(entry.summary ?? "") || "(empty)",
          toolName: undefined,
        };

      case "model_change":
        return {
          kind: "MODEL",
          preview: emphasize(theme.fg("dim", `[model: ${entry.modelId}]`)),
          full: `[model: ${entry.modelId}]`,
          toolName: undefined,
        };

      case "thinking_level_change":
        return {
          kind: "THINKING",
          preview: emphasize(theme.fg("dim", `[thinking: ${entry.thinkingLevel}]`)),
          full: `[thinking: ${entry.thinkingLevel}]`,
          toolName: undefined,
        };

      case "custom": {
        const full = entry.data === undefined ? `[custom: ${entry.customType}]` : safeJson(entry.data, 2);
        return {
          kind: entry.customType ? `${entry.customType}`.toUpperCase() : "CUSTOM",
          preview: emphasize(theme.fg("dim", `[custom: ${entry.customType}]`)),
          full,
          toolName: undefined,
        };
      }

      case "label":
        return {
          kind: "LABEL",
          preview: emphasize(theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`)),
          full: entry.label ?? "(cleared)",
          toolName: undefined,
        };

      case "session_info":
        return {
          kind: "SESSION TITLE",
          preview: emphasize(
            entry.name
              ? `${theme.fg("dim", "[title: ")}${theme.fg("dim", entry.name)}${theme.fg("dim", "]")}`
              : `${theme.fg("dim", "[title: ")}${theme.italic(theme.fg("dim", "empty"))}${theme.fg("dim", "]")}`,
          ),
          full: entry.name ?? "(empty)",
          toolName: undefined,
        };

      default:
        return {
          kind: "ENTRY",
          preview: emphasize(theme.fg("dim", "[entry]")),
          full: "[entry]",
          toolName: undefined,
        };
    }
  }

  extractContent(content, options = {}) {
    const { preview = false, includeToolCalls = false, verboseToolCalls = false } = options;

    if (typeof content === "string") {
      return preview ? normalizePreview(content) : normalizeDetail(content);
    }

    if (!Array.isArray(content)) return "";

    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;

      if (block.type === "text") {
        parts.push(preview ? normalizePreview(block.text) : normalizeDetail(block.text));
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

    return parts.filter(Boolean).join(preview ? " " : "\n\n");
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

  formatLabelTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const time = `${hours}:${minutes}`;

    if (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    ) {
      return time;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    if (date.getFullYear() === now.getFullYear()) {
      return `${month}/${day} ${time}`;
    }

    const year = date.getFullYear().toString().slice(-2);
    return `${year}/${month}/${day} ${time}`;
  }

  handleInput(keyData, keybindings) {
    if (keybindings.matches(keyData, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredNodes.length - 1 : this.selectedIndex - 1;
    } else if (keybindings.matches(keyData, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex === this.filteredNodes.length - 1 ? 0 : this.selectedIndex + 1;
    } else if (keybindings.matches(keyData, "app.tree.foldOrUp")) {
      const currentId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
      if (currentId && this.isFoldable(currentId) && !this.foldedNodes.has(currentId)) {
        this.foldedNodes.add(currentId);
        this.applyFilter();
      } else {
        this.selectedIndex = this.findBranchSegmentStart("up");
      }
    } else if (keybindings.matches(keyData, "app.tree.unfoldOrDown")) {
      const currentId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
      if (currentId && this.foldedNodes.has(currentId)) {
        this.foldedNodes.delete(currentId);
        this.applyFilter();
      } else {
        this.selectedIndex = this.findBranchSegmentStart("down");
      }
    } else if (keybindings.matches(keyData, "tui.editor.cursorLeft") || keybindings.matches(keyData, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - Math.max(1, this.maxVisibleLines - 1));
    } else if (keybindings.matches(keyData, "tui.editor.cursorRight") || keybindings.matches(keyData, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(this.filteredNodes.length - 1, this.selectedIndex + Math.max(1, this.maxVisibleLines - 1));
    } else if (keybindings.matches(keyData, "tui.select.confirm")) {
      const selected = this.filteredNodes[this.selectedIndex];
      if (selected && this.onSelect) this.onSelect(selected.node.entry.id);
    } else if (keybindings.matches(keyData, "tui.select.cancel")) {
      if (this.searchQuery) {
        this.searchQuery = "";
        this.foldedNodes.clear();
        this.applyFilter();
      } else if (this.onCancel) {
        this.onCancel();
      }
    } else if (matchesKey(keyData, "ctrl+d")) {
      this.filterMode = "default";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (matchesKey(keyData, "ctrl+t")) {
      this.filterMode = this.filterMode === "no-tools" ? "default" : "no-tools";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (matchesKey(keyData, "ctrl+u")) {
      this.filterMode = this.filterMode === "user-only" ? "default" : "user-only";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (matchesKey(keyData, "ctrl+l")) {
      this.filterMode = this.filterMode === "labeled-only" ? "default" : "labeled-only";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (matchesKey(keyData, "ctrl+a")) {
      this.filterMode = this.filterMode === "all" ? "default" : "all";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (matchesKey(keyData, "shift+ctrl+o")) {
      const currentIndex = FILTER_MODES.indexOf(this.filterMode);
      this.filterMode = FILTER_MODES[(currentIndex - 1 + FILTER_MODES.length) % FILTER_MODES.length];
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (matchesKey(keyData, "ctrl+o")) {
      const currentIndex = FILTER_MODES.indexOf(this.filterMode);
      this.filterMode = FILTER_MODES[(currentIndex + 1) % FILTER_MODES.length];
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (keybindings.matches(keyData, "tui.editor.deleteCharBackward")) {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.foldedNodes.clear();
        this.applyFilter();
      }
    } else if (keybindings.matches(keyData, "app.tree.editLabel")) {
      const selected = this.filteredNodes[this.selectedIndex];
      if (selected && this.onLabelEdit) this.onLabelEdit(selected.node.entry.id, selected.node.label);
    } else if (keybindings.matches(keyData, "app.tree.toggleLabelTimestamp")) {
      this.showLabelTimestamps = !this.showLabelTimestamps;
    } else {
      const hasControlChars = [...keyData].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
      });

      if (!hasControlChars && keyData.length > 0) {
        this.searchQuery += keyData;
        this.foldedNodes.clear();
        this.applyFilter();
      }
    }

    if (this.filteredNodes.length > 0) {
      this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? this.lastSelectedId;
    }
  }

  isFoldable(entryId) {
    const children = this.visibleChildrenMap.get(entryId);
    if (!children || children.length === 0) return false;
    const parentId = this.visibleParentMap.get(entryId);
    if (parentId === null || parentId === undefined) return true;
    const siblings = this.visibleChildrenMap.get(parentId);
    return siblings !== undefined && siblings.length > 1;
  }

  findBranchSegmentStart(direction) {
    const selectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
    if (!selectedId) return this.selectedIndex;

    const indexByEntryId = new Map(this.filteredNodes.map((node, index) => [node.node.entry.id, index]));
    let currentId = selectedId;

    if (direction === "down") {
      while (true) {
        const children = this.visibleChildrenMap.get(currentId) ?? [];
        if (children.length === 0) return indexByEntryId.get(currentId) ?? this.selectedIndex;
        if (children.length > 1) return indexByEntryId.get(children[0]) ?? this.selectedIndex;
        currentId = children[0];
      }
    }

    while (true) {
      const parentId = this.visibleParentMap.get(currentId) ?? null;
      if (parentId === null) return indexByEntryId.get(currentId) ?? this.selectedIndex;
      const children = this.visibleChildrenMap.get(parentId) ?? [];
      if (children.length > 1) {
        const segmentStart = indexByEntryId.get(currentId);
        if (segmentStart < this.selectedIndex) return segmentStart;
      }
      currentId = parentId;
    }
  }
}

export class TreeXComponent {
  constructor(options) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.config = { ...options.config };
    this.done = options.done;
    this.onLabelChange = options.onLabelChange;
    this.onConfigChange = options.onConfigChange;
    this.tree = options.tree;
    this.currentLeafId = options.currentLeafId;
    this.labelInput = null;
    this.labelEntryId = undefined;
    this._focused = false;
    this.nestedSelector = null;
    this.lastNestedTerminalHeight = null;

    this.treeState = this.createRailState(options.initialSelectedId, options.initialFilterMode);
    if (this.config.treeStyle === "nested") {
      this.nestedSelector = this.createNestedSelector(options.initialSelectedId, options.initialFilterMode);
    }
  }

  createRailState(initialSelectedId, initialFilterMode) {
    const state = new TreeState(
      this.tree,
      this.currentLeafId,
      Math.max(5, Math.floor(this.tui.terminal.rows / 2)),
      initialSelectedId,
      initialFilterMode,
    );

    state.onSelect = (entryId) => this.done({ type: "select", entryId });
    state.onCancel = () => this.done(undefined);
    state.onLabelEdit = (entryId, currentLabel) => this.showLabelInput(entryId, currentLabel);
    return state;
  }

  getDetailBodyLineCount() {
    return Math.max(1, this.config.detailPaneHeight - 1);
  }

  getDetailPaneLineCount(treeStyle = this.config.treeStyle) {
    const contentLines = this.getDetailBodyLineCount();
    return treeStyle === "nested" ? 2 + contentLines : 3 + contentLines;
  }

  getBaseVisibleRows() {
    return Math.max(5, Math.floor(this.tui.terminal.rows / 2));
  }

  getTargetComponentHeight() {
    return this.getBaseVisibleRows() + 9;
  }

  getNestedTerminalHeight() {
    const desiredVisibleRows = Math.max(5, this.getBaseVisibleRows() - this.getDetailPaneLineCount("nested"));
    return desiredVisibleRows * 2;
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

    selector.focused = this._focused;
    this.lastNestedTerminalHeight = this.getNestedTerminalHeight();
    return selector;
  }

  getNestedTreeList() {
    return this.nestedSelector?.getTreeList?.();
  }

  captureViewState() {
    if (this.config.treeStyle === "nested" && this.nestedSelector) {
      const treeList = this.getNestedTreeList();
      return {
        selectedId: treeList?.getSelectedNode?.()?.entry?.id,
        filterMode: treeList?.filterMode ?? "default",
        searchQuery: treeList?.searchQuery ?? "",
        showLabelTimestamps: Boolean(treeList?.showLabelTimestamps),
      };
    }

    return {
      selectedId: this.treeState.getSelectedNode()?.entry?.id,
      filterMode: this.treeState.filterMode,
      searchQuery: this.treeState.searchQuery,
      showLabelTimestamps: Boolean(this.treeState.showLabelTimestamps),
    };
  }

  applyViewStateToRail(viewState) {
    if (typeof viewState.searchQuery === "string") {
      this.treeState.searchQuery = viewState.searchQuery;
    }
    this.treeState.showLabelTimestamps = Boolean(viewState.showLabelTimestamps);
    this.treeState.applyFilter();
  }

  applyViewStateToNested(viewState) {
    const treeList = this.getNestedTreeList();
    if (!treeList) return;

    treeList.searchQuery = typeof viewState.searchQuery === "string" ? viewState.searchQuery : "";
    treeList.showLabelTimestamps = Boolean(viewState.showLabelTimestamps);
    treeList.applyFilter();
  }

  ensureNestedSelector() {
    const desiredTerminalHeight = this.getNestedTerminalHeight();
    if (!this.nestedSelector) {
      const viewState = this.captureViewState();
      this.nestedSelector = this.createNestedSelector(viewState.selectedId, viewState.filterMode);
      this.applyViewStateToNested(viewState);
      return;
    }

    if (this.lastNestedTerminalHeight !== desiredTerminalHeight) {
      const viewState = this.captureViewState();
      this.nestedSelector = this.createNestedSelector(viewState.selectedId, viewState.filterMode);
      this.applyViewStateToNested(viewState);
    }
  }

  switchViewMode() {
    const viewState = this.captureViewState();
    this.config = cycleViewMode(this.config);

    if (this.config.treeStyle === "nested") {
      this.nestedSelector = this.createNestedSelector(viewState.selectedId, viewState.filterMode);
      this.applyViewStateToNested(viewState);
    } else {
      this.treeState = this.createRailState(viewState.selectedId, viewState.filterMode);
      this.applyViewStateToRail(viewState);
    }

    this.onConfigChange?.(this.config);
  }

  applySharedLabelChange(entryId, label) {
    const labelTimestamp = label ? new Date().toISOString() : undefined;
    updateTreeNodeLabel(this.tree, entryId, label, labelTimestamp);
    this.treeState.updateNodeLabel(entryId, label, labelTimestamp);
    this.getNestedTreeList()?.updateNodeLabel?.(entryId, label, labelTimestamp);
    this.onLabelChange?.(entryId, label);
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    if (this.labelInput) this.labelInput.focused = value;
    if (this.nestedSelector) this.nestedSelector.focused = value;
  }

  invalidate() {
    this.labelInput?.invalidate?.();
    this.nestedSelector?.invalidate?.();
  }

  requestRender() {
    this.tui.requestRender();
  }

  showLabelInput(entryId, currentLabel) {
    this.labelEntryId = entryId;
    this.labelInput = new Input();
    this.labelInput.focused = this._focused;
    if (currentLabel) this.labelInput.setValue(currentLabel);
  }

  hideLabelInput() {
    this.labelEntryId = undefined;
    this.labelInput = null;
  }

  handleInput(keyData) {
    if (this.config.treeStyle !== "nested" && this.labelInput) {
      if (this.keybindings.matches(keyData, "tui.select.confirm")) {
        const value = this.labelInput.getValue().trim();
        if (this.labelEntryId) {
          this.applySharedLabelChange(this.labelEntryId, value || undefined);
        }
        this.hideLabelInput();
      } else if (this.keybindings.matches(keyData, "tui.select.cancel")) {
        this.hideLabelInput();
      } else {
        this.labelInput.handleInput(keyData);
      }

      this.requestRender();
      return;
    }

    if (matchesKey(keyData, "ctrl+v")) {
      this.switchViewMode();
      this.requestRender();
      return;
    }

    if (this.config.treeStyle === "nested") {
      this.ensureNestedSelector();
      this.nestedSelector.handleInput(keyData);
    } else {
      this.treeState.handleInput(keyData, this.keybindings);
    }

    this.requestRender();
  }

  getTitle(width) {
    const title = `${this.theme.bold(this.theme.fg("accent", "TreeX"))}${this.theme.fg("muted", ` · ${formatViewMode(this.config)}`)}`;
    return fitLine(title, width, this.theme);
  }

  getHelpLine(width) {
    const nextView = getTreeStyleLabel(this.config.treeStyle === "nested" ? "rail" : "nested");
    const originalHelp = `  ↑/↓: move. ←/→: page. ^←/^→ or Alt+←/Alt+→: fold/branch. ${upstreamKeyText("app.tree.editLabel")}: label. ^D/^T/^U/^L/^A: filters (^O/⇧^O cycle). ${upstreamKeyText("app.tree.toggleLabelTimestamp")}: label time`;
    const appendedHelp = `${originalHelp}. ^V: ${nextView} view`;
    return fitLine(this.theme.fg("muted", appendedHelp), width, this.theme);
  }

  getSearchLine(width) {
    const prefix = this.theme.fg("muted", "Type to search:");
    const query = this.treeState.getSearchQuery();
    const suffix = query ? ` ${this.theme.fg("accent", query)}` : "";
    return fitLine(`${prefix}${suffix}`, width, this.theme);
  }

  computeTreeHeight() {
    const labelRows = this.config.treeStyle === "nested" ? 0 : this.labelInput ? 4 : 0;
    const detailRows = this.getDetailPaneLineCount("rail");
    const staticRows = 4;
    const targetComponentHeight = this.getTargetComponentHeight();
    return Math.max(5, targetComponentHeight - staticRows - detailRows - labelRows);
  }

  getSelectedFlatNode() {
    if (this.config.treeStyle === "nested") {
      const selectedNode = this.getNestedTreeList()?.getSelectedNode?.();
      if (!selectedNode) return undefined;
      return this.treeState.flatNodes.find((flatNode) => flatNode.node.entry.id === selectedNode.entry.id);
    }

    return this.treeState.getSelectedFlatNode();
  }

  renderDetailPane(width, options = {}) {
    const { includeTopBorder = this.config.treeStyle !== "nested" } = options;
    const selected = this.getSelectedFlatNode();
    const maxBodyLines = this.getDetailBodyLineCount();

    if (!selected) {
      const lines = [];
      if (includeTopBorder) lines.push(fitLine(this.theme.fg("border", "─".repeat(width)), width, this.theme));
      lines.push(fitLine(this.theme.fg("muted", "NO SELECTION"), width, this.theme));
      for (let index = 0; index < maxBodyLines; index++) {
        lines.push(fitLine("", width, this.theme));
      }
      lines.push(fitLine(this.theme.fg("border", "─".repeat(width)), width, this.theme));
      return lines;
    }

    const info = this.treeState.describeEntry(selected.node, this.theme, false);
    const metadataParts = [
      this.theme.bold(this.theme.fg("accent", `DEPTH ${this.treeState.getDisplayDepth(selected)}`)),
      this.theme.bold(this.theme.fg("accent", `VIEW ${getTreeStyleLabel(this.config.treeStyle).toUpperCase()}`)),
      this.theme.bold(info.kind),
      this.theme.fg("muted", formatRelativeTime(selected.node.entry.timestamp)),
    ];

    if (info.toolName) metadataParts.push(this.theme.fg("muted", String(info.toolName).toUpperCase()));
    if (selected.node.label) metadataParts.push(this.theme.fg("warning", `[${selected.node.label}]`));
    if (selected.node.entry.id === this.currentLeafId) metadataParts.push(this.theme.fg("accent", "CURRENT"));

    const fullText = normalizeDetail(info.full || "") || "(no text)";
    const wrapped = wrapTextWithAnsi(fullText, width);
    const bodyLines = wrapped.slice(0, maxBodyLines);

    if (wrapped.length > maxBodyLines && bodyLines.length > 0) {
      const lastIndex = bodyLines.length - 1;
      bodyLines[lastIndex] = truncateToWidth(bodyLines[lastIndex], Math.max(1, width - 1), "") + this.theme.fg("muted", "…");
    }

    while (bodyLines.length < maxBodyLines) {
      bodyLines.push("");
    }

    const lines = [];
    if (includeTopBorder) lines.push(fitLine(this.theme.fg("border", "─".repeat(width)), width, this.theme));
    lines.push(fitLine(metadataParts.join(this.theme.fg("muted", " · ")), width, this.theme));

    for (const line of bodyLines) {
      lines.push(fitLine(line, width, this.theme));
    }

    lines.push(fitLine(this.theme.fg("border", "─".repeat(width)), width, this.theme));
    return lines;
  }

  renderLabelEditor(width) {
    if (!this.labelInput) return [];

    const lines = [];

    const prompt = fitLine(this.theme.fg("muted", "Label (empty to remove):"), width, this.theme);
    const inputLines = this.labelInput.render(width).map((line) => fitLine(line, width, this.theme));
    const hint = fitLine(
      this.theme.fg(
        "muted",
        `${formatKeys(this.keybindings, "tui.select.confirm")} save · ${formatKeys(this.keybindings, "tui.select.cancel")} cancel`,
      ),
      width,
      this.theme,
    );

    lines.push(prompt, ...inputLines, hint);
    return lines;
  }

  render(width) {
    const safeWidth = Math.max(20, width);

    if (this.config.treeStyle === "nested") {
      this.ensureNestedSelector();
      const nestedLines = [...this.nestedSelector.render(safeWidth)];
      if (nestedLines.length > 2) {
        nestedLines[2] = fitLine(
          `${this.theme.bold(this.theme.fg("accent", "TreeX"))}${this.theme.fg("muted", ` · ${getTreeStyleLabel("nested")}`)}`,
          safeWidth,
          this.theme,
        );
      }
      if (nestedLines.length > 3) {
        nestedLines[3] = this.getHelpLine(safeWidth);
      }
      return [...nestedLines, ...this.renderDetailPane(safeWidth, { includeTopBorder: false })];
    }

    this.treeState.setMaxVisibleLines(this.computeTreeHeight());

    return [
      this.getTitle(safeWidth),
      this.getHelpLine(safeWidth),
      this.getSearchLine(safeWidth),
      fitLine(this.theme.fg("border", "─".repeat(safeWidth)), safeWidth, this.theme),
      ...this.treeState.renderRows(safeWidth, "rail", this.theme),
      ...this.renderDetailPane(safeWidth),
      ...this.renderLabelEditor(safeWidth),
    ];
  }
}

export function getSelectedNodeText(component) {
  if (!component) return undefined;
  if (component.config?.treeStyle === "nested") {
    return component.getNestedTreeList?.()?.getSelectedNode?.();
  }
  return component?.treeState?.getSelectedNode?.();
}
