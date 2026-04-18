# pi-treex

TreeX enhances pi's native session tree with sticky-left indentation and a bottom detail pane.

It patches the built-in `/tree` view.

## Features

- sticky-left view that auto-shifts deep branches left to reclaim horizontal space
- bottom detail pane with more details for the selected row

## Usage

Load as a local extension while developing:

```bash
pi -e /absolute/path/to/pi-treex
```

Or install as a pi package and then use:

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

- Tested with pi 0.67.x.
- TreeX patches the native `/tree` path, so built-in slash command and tree hotkey keep using pi's own navigation and summary flow.
- TreeX relies on private interactive-mode internals, so upstream pi changes may require TreeX updates.
