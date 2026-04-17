# pi-treex

TreeX is an enhanced session tree viewer for [pi](https://pi.dev).

It adds a `/treex` command with an improved view.

## Features

- sticky-left view that auto-shifts deep branches left to reclaim horizontal space
- bottom detail pane with more details for the selected row

## Usage

Load as a local extension while developing:

```bash
pi -e /absolute/path/to/pi-treex
```

Or install as a pi package and then run:

```text
/treex
```

## Notes

- TreeX currently ships as `/treex` and does **not** override the built-in `/tree` keybinding.
- Vendored upstream files live under `vendor/pi/`.
- Selecting an entry uses pi's normal `navigateTree()` flow, including the optional branch summary prompt.
