import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES } from '../src/cases.js';

test('case library has distinct secret words and progressive clues', () => {
  assert.ok(CASES.length >= 12, 'expected a varied built-in case library');
  const words = CASES.map(c => c.word.toLowerCase());
  assert.equal(new Set(words).size, words.length, 'case words should be unique');
  for (const item of CASES) {
    assert.ok(item.word.length > 0);
    assert.ok(item.clues.length >= 3);
    assert.ok(item.clues.every(clue => typeof clue === 'string' && clue.length > 10));
  }
});

test('room-code alphabet excludes ambiguous characters', () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  assert.ok(!/[IO01]/.test(alphabet));
  assert.equal(alphabet.length, new Set(alphabet).size);
});
