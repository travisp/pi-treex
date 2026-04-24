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

| Before | After |
| --- | --- |
| <img src="https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/before.png" alt="Built-in pi /tree view with deep indentation wasting most horizontal space" width="360" /> | <img src="https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/after.png" alt="TreeX-enhanced /tree view with sticky-left indentation and a bottom detail pane" width="360" /> |
| The built-in tree can spend most of the viewport on indentation, leaving the actual row content heavily truncated. | TreeX shifts the visible branch left and keeps the selected row readable in a persistent detail pane. |

## Detail View

The detail view shows the depth of the currently selected item, what type of item it is, how long ago it occurred, and context usage for that point in the conversation when it can be inferred. For a tool, it will display what the tool result was. For a user or assistant message, it will display as much of the message as it can.

Context usage mirrors pi's own footer behavior: after a trailing user message it may be estimated from the last assistant usage, so it can differ slightly from the following assistant row's provider-reported value.

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
npm test        # run the integration test
```

## Notes

- Tested with pi 0.70.2
- TreeX patches the native `/tree` path, so built-in slash command and tree hotkey keep using pi's own navigation and summary flow.
- TreeX relies on private interactive-mode internals, so upstream pi changes may require TreeX updates.
