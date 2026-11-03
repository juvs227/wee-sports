# Bug tracking

Use the team's GitHub Issues and shared
[bug-tracking sheet](https://docs.google.com/spreadsheets/d/148Yg2oq_oThVIoVBBqqr2cJ4ScIAXOwDpwUxg_4GUHo/edit?gid=0#gid=0).
Include steps to reproduce, expected and actual results, the branch/commit,
sport, match format and whether the input came from real sensors or buttons.

For phone problems, record the phone/browser, whether the page uses HTTPS,
whether the address changed, the visible controller state and any connection
or motion diagnostics. Do not include authentication tokens or motion recordings
without checking their contents. For scoring problems, include the score before
the event, the serve/roll number and a screenshot of the resulting TV/phone UI.

Document the cause, fix and verification when resolving an issue. Link the
relevant commit or pull request, and distinguish automated coverage from a
physical-device playtest. See [testing](TESTING.md).
