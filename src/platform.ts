import * as vscode from 'vscode';

export function ensureSupportedPlatform(): boolean {
  if (process.platform !== 'win32') { return true; }
  void vscode.window.showErrorMessage('Agent Sessions does not support Windows yet. Use macOS, Linux, or WSL.');
  return false;
}
