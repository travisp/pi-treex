# Changelog

## Unreleased

## 0.4.0 - 2026-05-19

### Added

- Added a `Ctrl+R` full-detail drawer for truncated tree detail previews, with scrolling controls and a collapse hint.
- Added expanded rendering for user, assistant, tool result, bash execution, compaction, branch summary, and custom message details.
- Added a truncation hint in the compact detail pane when more content is available in the full-detail drawer.

### Changed

- Refactored TreeX detail rendering into separate wrapper, expanded drawer, and content-renderer helpers.
- Improved ANSI escape handling used by detail compaction, visible-text checks, and current-row marker placement.

### Fixed

- Fixed custom entry string data in the TreeX detail pane rendering escaped newlines instead of human-readable multiline text.
- Fixed expanded detail layout so it calculates the tree/detail split to fit the terminal while keeping up to about a dozen tree rows visible.

## 0.3.0 - 2026-05-07

### Changed

- Updated Pi package scope from `@mariozechner` to `@earendil-works` and tested with pi 0.74.0.

## 0.2.0 - 2026-04-27

### Changed

- Folded Pi's native tree position and filter status into the TreeX detail header to take up less vertical space.
- Rearranged and changed formatting of the detail metadata
- Switched the Pi extension entry and implementation from ESM JavaScript to TypeScript so `/reload` reliably picks up TreeX code changes.

### Fixed

- Fixed `/reload` using stale TreeX code because Node cached native ESM `.js` modules in-process.
