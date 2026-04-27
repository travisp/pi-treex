# Changelog

## 0.2.0 - 2026-04-27

### Changed

- Folded Pi's native tree position and filter status into the TreeX detail header to take up less vertical space.
- Rearranged and changed formatting of the detail metadata
- Switched the Pi extension entry and implementation from ESM JavaScript to TypeScript so `/reload` reliably picks up TreeX code changes.

### Fixed

- Fixed `/reload` using stale TreeX code because Node cached native ESM `.js` modules in-process.
