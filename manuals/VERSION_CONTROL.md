## Version Control Workflow

Our team follows a structured branching and review strategy to maintain code quality:

- **Branching Strategy:** Create a dedicated feature or bugfix branch for every change (e.g., `tennis-physics` or `scoreboard-bug`). Direct pushes to `main` are disabled.
- **Commit Standards:** Keep commits focused, modular, and self-contained. Always commit changes to `package-lock.json` alongside any dependency updates.
- **Commit Message Convention:** Use clear, descriptive messages prefixed by type (e.g., `add ball bounce physics`, `resolve scoreboard sync error`).
- **Pull Requests & Code Reviews:** All changes must be submitted via a Pull Request (PR) to `main`. Every PR requires at least one peer review approval and a passing CI build status before merging.