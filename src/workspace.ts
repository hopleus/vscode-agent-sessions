import * as vscode from 'vscode';

export function workspaceRoots(): string[] {
  return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
}

export function activeRoot(): string | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  const folder = editorUri && vscode.workspace.getWorkspaceFolder(editorUri);
  return folder?.uri.fsPath ?? workspaceRoots()[0];
}
