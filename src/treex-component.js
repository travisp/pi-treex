import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const DETAIL_BODY_LINES = 3;
const THEME_KEY = Symbol.for("@mariozechner/pi-coding-agent:theme");
const PATCH_STATE = Symbol.for("pi-treex:patch-state");
const ANSI_PATTERN = /\x1B\[[0-9;]*m/g;

function getTheme() {
  return globalThis[THEME_KEY];
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

function fitLine(line, width) {
  const truncated = truncateToWidth(line, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function isBlankLine(line) {
  return String(line ?? "").replace(ANSI_PATTERN, "").trim().length === 0;
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
    Math.min(treeList.selectedIndex - Math.floor(treeList.maxVisibleLines / 2), treeList.filteredNodes.length - treeList.maxVisibleLines),
  );

  return {
    startIndex,
    endIndex: Math.min(startIndex + treeList.maxVisibleLines, treeList.filteredNodes.length),
  };
}

function getStickyLeftMetrics(treeList) {
  const { startIndex, endIndex } = getVisibleWindow(treeList);
  if (startIndex === endIndex) {
    return {
      stickyLeftShift: 0,
      stickyLeftDepth: null,
    };
  }

  let minVisibleDisplayIndent = Infinity;
  for (let index = startIndex; index < endIndex; index++) {
    minVisibleDisplayIndent = Math.min(minVisibleDisplayIndent, getDisplayIndent(treeList, treeList.filteredNodes[index]));
  }

  const stickyLeftShift = Math.max(0, minVisibleDisplayIndent - 1);

  return {
    stickyLeftShift,
    stickyLeftDepth: stickyLeftShift > 0 ? minVisibleDisplayIndent + 1 : null,
  };
}

function shiftGutters(gutters, stickyLeftShift) {
  if (stickyLeftShift === 0) return gutters;

  return gutters.map((gutter) => ({ ...gutter, position: gutter.position - stickyLeftShift })).filter((gutter) => gutter.position >= 0);
}

function patchTreeListRender(treeList) {
  if (treeList.__treexStickyLeftPatched) return;

  const originalRender = treeList.render.bind(treeList);
  treeList.__treexStickyLeftPatched = true;

  treeList.render = function renderStickyLeft(width) {
    const { startIndex, endIndex } = getVisibleWindow(this);
    const { stickyLeftShift } = getStickyLeftMetrics(this);
    if (stickyLeftShift === 0) {
      return originalRender(width);
    }

    const originals = [];

    for (let index = startIndex; index < endIndex; index++) {
      const flatNode = this.filteredNodes[index];
      const shiftedDisplayIndent = Math.max(0, getDisplayIndent(this, flatNode) - stickyLeftShift);

      originals.push({
        flatNode,
        indent: flatNode.indent,
        gutters: flatNode.gutters,
      });

      flatNode.indent = this.multipleRoots ? shiftedDisplayIndent + 1 : shiftedDisplayIndent;
      flatNode.gutters = shiftGutters(flatNode.gutters, stickyLeftShift);
    }

    try {
      return originalRender(width);
    } finally {
      for (const original of originals) {
        original.flatNode.indent = original.indent;
        original.flatNode.gutters = original.gutters;
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
    } else if (block.type === "toolCall" && includeToolCalls) {
      parts.push(
        verboseToolCalls ? formatToolCallVerbose(block.name, block.arguments) : treeList.formatToolCall(block.name, block.arguments),
      );
    } else if (block.type === "image") {
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
          toolName: undefined,
        };
      }

      if (message.role === "assistant") {
        return {
          kind: "ASSISTANT",
          full:
            extractDetailContent(treeList, message.content, { includeToolCalls: true, verboseToolCalls: true }) ||
            message.errorMessage ||
            (message.stopReason === "aborted" ? "(aborted)" : "(no content)"),
          toolName: undefined,
        };
      }

      if (message.role === "toolResult") {
        const toolCall = message.toolCallId ? treeList.toolCallMap.get(message.toolCallId) : undefined;
        const toolName = message.toolName ?? toolCall?.name;
        return {
          kind: "TOOL RESULT",
          full:
            extractDetailContent(treeList, message.content, { includeToolCalls: true, verboseToolCalls: true }) ||
            (toolCall ? formatToolCallVerbose(toolCall.name, toolCall.arguments) : `[${toolName ?? "tool"}]`),
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
        full: extractDetailContent(treeList, entry.content, { includeToolCalls: true }) || "(empty)",
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

function getTreeVisibleRows(tui) {
  return Math.max(5, Math.floor(tui.terminal.rows / 2) - (DETAIL_BODY_LINES + 2));
}

function isNativeTreeSelector(component) {
  return (
    component?.constructor?.name === "TreeSelectorComponent" &&
    typeof component.getTreeList === "function" &&
    typeof component.render === "function" &&
    typeof component.handleInput === "function"
  );
}

function getTreeSelector(result) {
  if (isNativeTreeSelector(result?.focus)) return result.focus;
  if (isNativeTreeSelector(result?.component)) return result.component;
  return null;
}

export class TreeXWrapper {
  constructor(options) {
    this.selector = options.selector;
    this.tui = options.tui;
    this.currentLeafId = options.currentLeafId;
    patchTreeListRender(this.treeList);
  }

  get treeList() {
    return this.selector.getTreeList();
  }

  syncLayout() {
    this.treeList.maxVisibleLines = getTreeVisibleRows(this.tui);
  }

  get focused() {
    return this.selector.focused;
  }

  set focused(value) {
    this.selector.focused = value;
  }

  invalidate() {
    this.selector.invalidate?.();
  }

  handleInput(keyData) {
    this.syncLayout();
    this.selector.handleInput(keyData);
    this.tui.requestRender();
  }

  dispose() {
    this.selector.dispose?.();
  }

  getStickyLeftLine(width, stickyLeftDepth) {
    const theme = getTheme();
    if (!stickyLeftDepth || !theme) {
      return fitLine("", width);
    }

    const badge = theme.bg(
      "selectedBg",
      ` ${theme.bold(theme.fg("accent", "⇤"))} ${theme.bold(theme.fg("accent", `depth ${stickyLeftDepth}`))} `,
    );

    return fitLine(`  ${badge}`, width);
  }

  renderDetailPane(width) {
    const theme = getTheme();
    if (!theme) return [];

    const selected = this.treeList.filteredNodes[this.treeList.selectedIndex];

    if (!selected) {
      return [
        fitLine(theme.fg("muted", "NO SELECTION"), width),
        ...Array.from({ length: DETAIL_BODY_LINES }, () => fitLine("", width)),
        fitLine(theme.fg("border", "─".repeat(width)), width),
      ];
    }

    const info = describeEntry(this.treeList, selected.node);
    const metadataParts = [
      theme.bold(theme.fg("accent", `DEPTH ${getDisplayDepth(this.treeList, selected)}`)),
      theme.bold(info.kind),
      theme.fg("muted", formatRelativeTime(selected.node.entry.timestamp)),
    ];

    if (info.toolName) metadataParts.push(theme.fg("muted", String(info.toolName).toUpperCase()));
    if (selected.node.label) metadataParts.push(theme.fg("warning", `[${selected.node.label}]`));
    if (selected.node.entry.id === this.currentLeafId) metadataParts.push(theme.fg("accent", "CURRENT"));

    const fullText = normalizeDetail(info.full || "") || "(no text)";
    const wrappedLines = wrapTextWithAnsi(fullText, width);
    const bodyLines = wrappedLines.slice(0, DETAIL_BODY_LINES);

    if (wrappedLines.length > DETAIL_BODY_LINES && bodyLines.length > 0) {
      const lastLine = bodyLines.length - 1;
      bodyLines[lastLine] = truncateToWidth(bodyLines[lastLine], Math.max(1, width - 1), "") + theme.fg("muted", "…");
    }

    while (bodyLines.length < DETAIL_BODY_LINES) {
      bodyLines.push("");
    }

    return [
      fitLine(metadataParts.join(theme.fg("muted", " · ")), width),
      ...bodyLines.map((line) => fitLine(line, width)),
      fitLine(theme.fg("border", "─".repeat(width)), width),
    ];
  }

  render(width) {
    const safeWidth = Math.max(20, width);

    this.syncLayout();
    const lines = [...this.selector.render(safeWidth)];
    const { stickyLeftDepth } = getStickyLeftMetrics(this.treeList);

    if (stickyLeftDepth) {
      const badgeIndex = lines.findIndex((line, index) => index >= 5 && isBlankLine(line));
      const badgeLine = this.getStickyLeftLine(safeWidth, stickyLeftDepth);
      if (badgeIndex >= 0) lines[badgeIndex] = badgeLine;
      else lines.push(badgeLine);
    }

    return [...lines, ...this.renderDetailPane(safeWidth)];
  }
}

export function installTreeXNativePatches(InteractiveMode) {
  const proto = InteractiveMode?.prototype;
  if (!proto || proto[PATCH_STATE]) return;

  proto[PATCH_STATE] = {
    originalShowSelector: proto.showSelector,
  };

  proto.showSelector = function treexShowSelector(create) {
    return proto[PATCH_STATE].originalShowSelector.call(this, (done) => {
      const result = create(done);
      const selector = getTreeSelector(result);
      if (!selector) {
        return result;
      }

      const wrapper = new TreeXWrapper({
        selector,
        tui: this.ui,
        currentLeafId: this.sessionManager.getLeafId(),
      });

      return {
        component: wrapper,
        focus: wrapper,
      };
    });
  };
}
