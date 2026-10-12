import * as vscode from 'vscode';

export function isSupportedPlatform(): boolean {
  return process.platform !== 'win32';
}

export function ensureSupportedPlatform(): boolean {
  if (isSupportedPlatform()) { return true; }
  void vscode.window.showErrorMessage('Agent Sessions does not support Windows yet. Use macOS, Linux, or WSL.');
  return false;
}
