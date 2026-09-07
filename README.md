# pi-treex

TreeX enhances pi's native session tree with sticky-left indentation and a bottom detail pane.

It patches the built-in `/tree` view.

## WARNING

This extension patches the /tree internals and could break if pi updates in an incompatible way. I chose this approach rather than re-implementing (or copying) the internal tree rendering so that it would automatically update the rendering.


## Features

- sticky-left view that auto-shifts deep branches left to reclaim horizontal space
- bottom detail pane with more details for the selected row
- detail metadata shows context usage for the selected point when it can be inferred
- Adds a ◆ marker to the current point in the session tree, plus an ↑/↓ CURRENT hint in the detail pane when you're browsing away from it.

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

Captured at 50 columns with a Rose Pine-inspired theme.

## Detail View

The detail view shows the depth of the currently selected item, what type of item it is, how long ago it occurred, and context usage for that point in the conversation when it can be inferred. For a tool, it will display what the tool result was. For a user or assistant message, it will display as much of the message as it can. When the preview is truncated, it shows an inline `Ctrl+R full` hint; press `Ctrl+R` to expand the detail drawer into a scrollable full-detail view.

Context usage calculation mirrors pi's own footer behavior: after a trailing user message it may be estimated from the last assistant usage, so it can differ slightly from the following assistant row's provider-reported value.

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

## Development

```bash
npm run check   # lint + style check + tests
npm run format  # format files
npm test        # run the integration tests
```

### Manual release checks

Repeat on both the npm Node CLI and the standalone Pi executable, loading this checkout with `pi -ne -e ./treex.ts`:

1. Open `/tree` in a session containing user and assistant messages; verify the detail previews.
2. Press `Ctrl+R` to expand a long message, scroll, and collapse it.
3. Close the tree, run `/reload`, and verify the tree and expanded details still work.

## Notes

- Tested with pi 0.85.1 using both the npm Node CLI and the standalone Bun executable.
- Native classes are imported through Pi's extension loader, so TreeX does not depend on the executable's filesystem layout.
- TreeX patches the native `/tree` path, so built-in slash command and tree hotkey keep using pi's own navigation and summary flow.
- TreeX relies on private interactive-mode internals, so upstream pi changes may require TreeX updates.
