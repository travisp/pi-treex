# pi-treex

TreeX is an enhanced session tree viewer for [pi](https://pi.dev).

It adds a `/treex` command with 2 view styles:

- original
- rail

The detail pane is always visible.

## Features

- fixed-width rail gutter mode for deep trees
- bottom detail pane with full content for the selected row
- original mode uses a vendored copy of pi's upstream tree component internally
- same tree navigation/filter/search keys as built-in `/tree`
- label editing from the tree
- per-user view mode persistence in `~/.pi/agent/treex.json`

## Usage

Load as a local extension while developing:

```bash
pi -e /absolute/path/to/pi-treex
```

Or install as a pi package and then run:

```text
/treex
```

## Keys inside TreeX

- `↑/↓`: move
- `←/→` or `PageUp/PageDown`: page
- `Ctrl+←/Ctrl+→` or `Alt+←/Alt+→`: fold / branch segment nav
- `Shift+L`: edit label
- `Shift+T`: toggle label timestamps
- `Ctrl+D/Ctrl+T/Ctrl+U/Ctrl+L/Ctrl+A`: filters
- `Ctrl+O` / `Shift+Ctrl+O`: cycle filters
- `Ctrl+V`: toggle original / rail
- `Type to search`
- `Enter`: navigate
- `Esc`: close (or clear search first)

## Notes

- TreeX currently ships as `/treex` and does **not** override the built-in `/tree` keybinding.
- Vendored upstream files live under `vendor/pi/`.
- Selecting an entry uses pi's normal `navigateTree()` flow, including the optional branch summary prompt.
