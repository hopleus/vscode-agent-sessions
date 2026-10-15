# Changelog

## 0.4.4

- Fixed the status bar turning yellow at 0%: the warning and error background now follow the limit shown in the status bar, not the highest of all windows
- Added `agentSessions.limits.statusBarWindow` (`first` or `highest`) to choose which limit the status bar shows and colors by

## 0.4.3

- Claude usage is requested once for all open windows: they share the last result and the rate limit backoff
- The last known Claude value stays on screen when Claude rate limits or is unreachable
- The time until reset includes minutes for resets more than a day away (`3d 3h 12m`)

## 0.4.2

- Usage limits are re-read when the window regains focus, and are refreshed every minute by default
- Added `agentSessions.limits.refreshMinutes` (1–60) to set the refresh interval

## 0.4.1

- Fixed the time until reset in the status bar lagging behind: it now updates when the displayed minute or hour changes and when the window regains focus

## 0.4.0

- Added a status bar item with your usage limit in percent and the time until it resets; hover it for the limits of the active session's agent (5-hour, 7-day and so on, with bars and reset times); click it to refresh
- The status bar item turns to the warning or error background from configurable usage percentages (`agentSessions.limits.warningPercent`, `agentSessions.limits.errorPercent`)
- The limits can be turned off with `agentSessions.limits.enabled`: nothing is added to the status bar and no data is collected
- For OpenCode sessions the status bar shows the tokens spent in the session (cost and breakdown in the tooltip)
- Codex usage limits are read from local session files
- Claude Code usage limits are available as an opt-in: you are asked once, or use `agentSessions.limits.claude.enabled`

## 0.3.1

- Fixed duplicated tabs and duplicated agent processes after the extension host is restarted (for example by "Restart Extensions"): sessions that are still running are picked up instead of being opened a second time

## 0.3.0

- Added OpenCode support: its sessions appear in the list with their titles, resume with one click and show up in the New Session menu
- Fixed restored session tabs opening blank or disappearing after reopening the window: tabs are now restored only once the terminal backend is ready
- The session list refreshes by itself when a new OpenCode session appears
- Requires VS Code 1.101 or newer

## 0.2.0

- Panel in the Activity Bar listing Claude Code and Codex sessions of the workspace
- Resume a session in an editor tab with one click
- New Session button with an agent picker
- Pin and rename sessions
- Session tabs are restored after reopening the window
- Multi-root workspace support
- Titles read from the agents (Claude Code AI titles and `/rename`, Codex thread names)
