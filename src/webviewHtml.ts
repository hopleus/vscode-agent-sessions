import * as crypto from 'crypto';
import * as vscode from 'vscode';

export function buildWebviewHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
  const asset = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, path));
  const nonce = crypto.randomBytes(16).toString('base64');
  const source = webview.cspSource;
  const csp = [
    "default-src 'none'",
    `style-src ${source} 'unsafe-inline'`,
    `font-src ${source}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" id="vscode-codicon-stylesheet" href="${asset('vendor/codicon.css')}">
<link rel="stylesheet" href="${asset('main.css')}">
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
<div id="app"></div>
<script nonce="${nonce}" src="${asset('dist/main.js')}"></script>
</body>
</html>`;
}
