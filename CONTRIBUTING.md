# Contributing

## Setup

```sh
npm install
npm run compile   # extension (tsc) + webview (esbuild)
npm test          # unit tests
```

Press F5 to start the Extension Development Host. It opens this repository as the workspace, so its own Claude sessions show up in the panel.

While developing:

- `npm run watch` recompiles the extension, `npm run watch:webview` rebuilds the webview bundle.
- `npm run typecheck` checks both TypeScript projects without emitting files.

## Layout

- `src/extension.ts` – activation and command registration
- `src/sessionService.ts` – application logic: state, open, start, pin, rename, restore
- `src/view.ts`, `src/webviewHtml.ts` – webview provider and its HTML
- `src/terminals.ts` – editor-tab terminals, tab icons, binding of new Codex sessions
- `src/storage.ts` – pins, custom names and open sessions in workspace state
- `src/agents.ts` – built-in agents and user overrides
- `src/protocol.ts` – messages exchanged with the webview, with runtime validation
- `src/sessions` – session sources (`claude.ts`, `codex.ts`), catalog, file watcher, JSONL helpers, tests
- `src/webview` – webview UI, bundled by esbuild into `media/dist` (not committed)

## Adding an agent

Implement `SessionSource` from `src/sessions/types.ts` (list sessions, watch target, resume and new-session commands), register it in `SessionCatalog` in `sessionService.ts`, add the agent to `BUILT_IN_AGENTS` and drop its icons into `media/icons` (`<id>-light.svg`, `<id>-dark.svg`) and `src/webview/icons.ts`.

Session sources must not import `vscode`, so they stay testable with plain `node:test`.

## Releasing

Development happens in `develop`, releases are built from `main`.

1. Merge `develop` into `main`.
2. On `main`, bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
3. Tag the commit and push the tag:

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

The `Release` workflow checks that the tag matches `package.json` and points to a commit on `main`, runs the tests, builds a `.vsix` for each platform and attaches them to a GitHub release.

Publishing to the Marketplace is manual: download the `.vsix` files from the release, open the [publisher management page](https://marketplace.visualstudio.com/manage), choose **New extension → Visual Studio Code** (or **Update** on the existing extension) and upload each file.
