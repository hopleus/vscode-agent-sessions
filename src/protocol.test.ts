import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSessionContext, parseWebviewMessage, SESSION_SECTION } from './protocol';

describe('parseWebviewMessage', () => {
  it('accepts well-formed messages', () => {
    assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepEqual(parseWebviewMessage({ type: 'open', id: 'a', agentId: 'claude' }), { type: 'open', id: 'a', agentId: 'claude' });
    assert.deepEqual(parseWebviewMessage({ type: 'new' }), { type: 'new', agentId: undefined });
    assert.deepEqual(parseWebviewMessage({ type: 'new', agentId: 'codex' }), { type: 'new', agentId: 'codex' });
  });

  it('rejects malformed messages', () => {
    assert.equal(parseWebviewMessage(undefined), undefined);
    assert.equal(parseWebviewMessage('open'), undefined);
    assert.equal(parseWebviewMessage({ type: 'unknown' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'open', id: 1, agentId: 'claude' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'open', id: '', agentId: 'claude' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'new', agentId: 5 }), undefined);
    assert.equal(parseWebviewMessage({ type: 'pin', id: 'a', pinned: true }), undefined);
  });
});

describe('parseSessionContext', () => {
  const context = {
    webviewSection: SESSION_SECTION, sessionId: 'a', sessionAgent: 'claude', sessionTitle: 'T',
    sessionPinned: false, sessionChrome: false, preventDefaultContextMenuItems: true,
  };

  it('accepts the context of a session row', () => {
    assert.deepEqual(parseSessionContext(context), context);
  });

  it('rejects other contexts', () => {
    assert.equal(parseSessionContext(undefined), undefined);
    assert.equal(parseSessionContext({ ...context, webviewSection: 'other' }), undefined);
    assert.equal(parseSessionContext({ ...context, sessionId: '' }), undefined);
    assert.equal(parseSessionContext({ ...context, sessionTitle: 1 }), undefined);
  });
});
