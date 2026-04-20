# pi-treex

TreeX enhances pi's native session tree with sticky-left indentation and a bottom detail pane.

It patches the built-in `/tree` view.

## WARNING

This extension patches the /tree internals and could break if pi updates in an incompatible way. I chose this approach rather than re-implementing (or copying) the internal tree rendering so that it would automatically update the rendering.


## Features

- sticky-left view that auto-shifts deep branches left to reclaim horizontal space
- bottom detail pane with more details for the selected row
- Adds a ◆ marker to the current point in the session tree more easily see where when changing lines.

## Screenshots

| Before | After |
| --- | --- |
| <img src="https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/before.png" alt="Built-in pi /tree view with deep indentation wasting most horizontal space" width="360" /> | <img src="https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/after.png" alt="TreeX-enhanced /tree view with sticky-left indentation and a bottom detail pane" width="360" /> |
| The built-in tree can spend most of the viewport on indentation, leaving the actual row content heavily truncated. | TreeX shifts the visible branch left and keeps the selected row readable in a persistent detail pane. |

## Detail View

The detail view shows the depth of the currently selected item, what type of item it is, and how long ago it occurred. For a tool, it will display what the tool result was. For a user or assistant message, it will display as much of the message as it can.

## Installation

### npm (coming when I get around to it)

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

- Tested with pi 0.67.68
- TreeX patches the native `/tree` path, so built-in slash command and tree hotkey keep using pi's own navigation and summary flow.
- TreeX relies on private interactive-mode internals, so upstream pi changes may require TreeX updates.
