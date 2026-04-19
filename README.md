# pi-treex

TreeX enhances pi's native session tree with sticky-left indentation and a bottom detail pane.

It patches the built-in `/tree` view.

## WARNING

This extension patches the /tree internals and could break if pi updates in an incompatible way. I chose this approach rather than re-implementing (or copying) the internal tree rendering so that it would automatically update the rendering.


## Features

- sticky-left view that auto-shifts deep branches left to reclaim horizontal space
- bottom detail pane with more details for the selected row

## Screenshots

### Before

![Built-in pi /tree view with deep indentation wasting most horizontal space](https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/before.png)

The built-in tree can spend most of the viewport on indentation, leaving the actual row content heavily truncated.

### After

![TreeX-enhanced /tree view with sticky-left indentation and a bottom detail pane](https://raw.githubusercontent.com/travisp/pi-treex/main/screenshots/after.png)

TreeX shifts the visible branch left and keeps the selected row readable in a persistent detail pane.

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
