# Future Notes

The following features were removed for now to keep the tool stable around full-board extraction:

- Puzzle mode (partial-board detection and mapping).
- Editable visible columns/rows for partial snippets.
- Line cleanup preprocessing modes.

Why removed now:

- Detection behavior was inconsistent and often reduced accuracy.
- UI complexity made troubleshooting harder during normal full-board use.

Potential revisit direction:

- Reintroduce partial-board support behind a dedicated advanced toggle.
- Improve grid-line detection before re-adding visible cols/rows controls.
- Add objective quality checks for preprocessing before exposing cleanup options again.
