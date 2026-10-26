import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentShortcuts } from '../src/keyboard.js';

test('assigns initials and resolves collisions down the name', () => {
  assert.deepEqual(Object.fromEntries(assignmentShortcuts(['Common', 'David', 'Bruno'])), {
    Common: 'c', David: 'd', Bruno: 'b',
  });
  assert.deepEqual(Object.fromEntries(assignmentShortcuts(['Common', 'David', 'Daniel'])), {
    Common: 'c', David: 'd', Daniel: 'a',
  });
});

test('reserves other initials before walking colliding names', () => {
  const shortcuts = assignmentShortcuts(['Common', 'David', 'Daniel', 'Alice', 'DAN']);
  assert.equal(shortcuts.get('Alice'), 'a');
  assert.equal(shortcuts.get('Daniel'), 'n');
  assert.equal(shortcuts.has('DAN'), false);
});

test('skips punctuation and supports accented names', () => {
  assert.deepEqual(Object.fromEntries(assignmentShortcuts(['Common', ' Éva', 'Émile', '---'])), {
    Common: 'c', ' Éva': 'é', 'Émile': 'm',
  });
});
