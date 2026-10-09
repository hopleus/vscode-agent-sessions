import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWebviewMessage } from './protocol';

describe('parseWebviewMessage', () => {
  it('accepts well-formed messages', () => {
    assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepEqual(parseWebviewMessage({ type: 'open', id: 'a', agentId: 'claude' }), { type: 'open', id: 'a', agentId: 'claude' });
    assert.deepEqual(parseWebviewMessage({ type: 'new' }), { type: 'new', agentId: undefined });
    assert.deepEqual(parseWebviewMessage({ type: 'new', agentId: 'codex' }), { type: 'new', agentId: 'codex' });
    assert.deepEqual(parseWebviewMessage({ type: 'pin', id: 'a', pinned: true }), { type: 'pin', id: 'a', pinned: true });
    assert.deepEqual(parseWebviewMessage({ type: 'rename', id: 'a', title: 'T' }), { type: 'rename', id: 'a', title: 'T' });
  });

  it('rejects malformed messages', () => {
    assert.equal(parseWebviewMessage(undefined), undefined);
    assert.equal(parseWebviewMessage('open'), undefined);
    assert.equal(parseWebviewMessage({ type: 'unknown' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'open', id: 1, agentId: 'claude' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'open', id: '', agentId: 'claude' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'pin', id: 'a', pinned: 'yes' }), undefined);
    assert.equal(parseWebviewMessage({ type: 'new', agentId: 5 }), undefined);
  });
});
