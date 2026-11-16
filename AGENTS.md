# Project context

## Stack
- Windows and PowerShell; Node.js built-in HTTP server and CommonJS modules.
- Plain HTML/CSS/JavaScript frontend. The pixel office uses Canvas.
- No runtime npm dependencies; jsdom is a development dependency for DOM tests.
- Existing user preferences and work ownership rules from the parent AGENTS.md apply.

## Commands
- Install test dependencies: `npm ci`
- Test: `npm test`
- Run: `npm start` (default http://localhost:4777, loopback only)
- Check changes: `git diff --check`

## Conventions
- User-facing text in Spanish; code and identifiers in English.
- Keep a task and file ownership in PLAN.md before editing.
- Do not commit or push unless requested. Do not read or edit .env or credentials.
- Office data belongs in ~/.ai-workspace and its configured Obsidian vault.
- Discovery reads only immediate project folders and metadata markers; importing must require an explicit category.
- Never interpolate prompts or model values into shell command strings.
- Chat tool permissions must remain enforced by the selected CLI.
- Every project chat turn combines Claude and Codex sequentially: the responsible agent handles the request, the other reviews read-only. Never silently fall back to one provider.
- Keep the Windows Live Messenger conversation skin unchanged when editing Windows 98 navigation chrome.
- Tests must use temporary folders and fake agents, never actual user projects or paid model calls.
