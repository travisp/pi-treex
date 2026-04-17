import { TreeXComponent } from "./src/treex-component.js";

async function promptForNavigationOptions(ctx) {
  while (true) {
    const choice = await ctx.ui.select("Summarize branch?", [
      "No summary",
      "Summarize",
      "Summarize with custom prompt",
    ]);

    switch (choice) {
      case undefined:
        return { type: "back" };
      case "No summary":
        return { summarize: false };
      case "Summarize":
        return { summarize: true };
      default: {
        const customInstructions = await ctx.ui.editor("Custom summarization instructions", "");
        if (customInstructions === undefined) continue;

        return {
          summarize: true,
          customInstructions: customInstructions.trim() || undefined,
        };
      }
    }
  }
}

async function openTreeX(pi, ctx) {
  let initialSelectedId;

  while (true) {
    const tree = ctx.sessionManager.getTree();
    const currentLeafId = ctx.sessionManager.getLeafId();

    if (tree.length === 0) {
      ctx.ui.notify("No entries in session", "info");
      return;
    }

    const result = await ctx.ui.custom((tui, theme, _keybindings, done) => {
      return new TreeXComponent({
        tui,
        theme,
        tree,
        currentLeafId,
        initialSelectedId,
        done,
        onLabelChange: (entryId, label) => pi.setLabel(entryId, label),
      });
    });

    if (!result || result.type !== "select") return;

    initialSelectedId = result.entryId;

    if (result.entryId === currentLeafId) {
      ctx.ui.notify("Already at this point", "info");
      continue;
    }

    const navigationOptions = await promptForNavigationOptions(ctx);
    if (navigationOptions.type === "back") continue;

    const navigationResult = await ctx.navigateTree(result.entryId, navigationOptions);
    if (navigationResult.cancelled) {
      ctx.ui.notify("Navigation cancelled", "warning");
      continue;
    }

    ctx.ui.notify("Navigated to selected point", "info");
    return;
  }
}

export default function treeXExtension(pi) {
  pi.registerCommand("treex", {
    description: "Enhanced session tree viewer with sticky-left original view and detail pane",
    handler: (_args, ctx) => openTreeX(pi, ctx),
  });
}
