# pi-treex

TreeX enhances pi's native session tree with sticky-left indentation and a bottom detail pane.

It patches the built-in `/tree` view.

## WARNING

This extension patches the /tree internals and could break if pi updates in an incompatible way. I chose this approach rather than re-implementing (or copying) the internal tree rendering so that it would automatically update the rendering.


## Features

- sticky-left view that auto-shifts deep branches left to reclaim horizontal space
- full-screen compact view below 40 terminal rows, designed for phones with the keyboard open or closed
- bottom detail pane with more details for the selected row
- desktop detail metadata shows context usage for the selected point when it can be inferred
- adds a ◆ marker to the current point in the session tree, plus an ↑/↓ CURRENT hint in desktop detail metadata when you're browsing away from it

## Screenshots

<table>
  <tr>
    <th width="50%">Before</th>
    <th width="50%">After</th>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/before.png" alt="Native Pi 0.82 session tree at a phone-sized 50-column width" width="100%" /></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/after.png" alt="TreeX session tree with compact phone indentation and a bottom detail pane" width="100%" /></td>
  </tr>
  <tr>
    <td>Pi keeps the selected row visible, but deep branch gutters still consume much of a narrow viewport.</td>
    <td>TreeX removes shared phone-width indentation while preserving relative branches, native panning, and selected-message detail.</td>
  </tr>
</table>

Captured at 50 columns with a Rose Pine-inspired theme. These screenshots predate the full-screen compact layout described below.

## Detail View

On taller terminals, the detail view shows the depth of the currently selected item, what type of item it is, how long ago it occurred, and context usage for that point in the conversation when it can be inferred. Below 40 rows, this metadata line is hidden to give the tree more space. For a tool, it will display what the tool result was. For a user or assistant message, it will display as much of the message as it can. When the preview is truncated, it shows an inline `^r full` hint (`^` means Ctrl); press `Ctrl+R` to expand the detail drawer into a scrollable full-detail view.

Context usage calculation mirrors pi's own footer behavior at the selected entry: after a trailing user message it may be estimated from the last assistant usage. After a context edit, it estimates the effective context instead of trusting stale usage. After compaction, usage remains unknown until a surviving assistant response supplies it.

Context edits appear in the native tree's “all” filter. Their details show the target entry and whether it was omitted from model context or replaced, including the replacement content. Original history remains unchanged.

## Installation

### npm

```bash
pi install npm:pi-treex
```

To try it for one run without adding it to your settings:

```bash
pi -e npm:pi-treex
```

### git

```bash
pi install git:github.com/travisp/pi-treex
```

## Usage

After installation, use:

```text
/tree
```

## Compact View

Below 40 terminal rows, TreeX automatically switches to a full-screen layout with shorter `u:`/`a:` labels and less visual chrome. Branch connectors, selection/current markers, and the three-line preview remain.

The header combines the filter, cycling shortcut, and search hint: `[no-tools] ^o · Type to search`. A query line appears only while searching. Shortcut notation: `^` Ctrl, `⌥` Alt, `⇧` Shift.

Press `Ctrl+R` to expand the preview; `Esc` or `Ctrl+R` collapses it.

## Development

```bash
devbox run -- npm ci --ignore-scripts
devbox run check                 # lint + style check + tests
devbox run -- npm run format     # format files
devbox run -- npm test           # run the integration tests
```

## Notes

- Requires pi 0.87.1 or newer; integration tests target 0.87.1.
- Native classes are imported through Pi's extension loader, so TreeX does not depend on the executable's filesystem layout.
- TreeX patches the native `/tree` path, so built-in slash command and tree hotkey keep using pi's own navigation and summary flow.
- TreeX relies on private interactive-mode internals, so upstream pi changes may require TreeX updates.
