/** Assign unique letter shortcuts in name order, reserving each available initial first. */
export function assignmentShortcuts(names) {
  const shortcuts = new Map();
  const used = new Set();
  const letters = name => [...name.toLowerCase()].filter(letter => /\p{L}/u.test(letter));

  for (const name of names) {
    const initial = letters(name)[0];
    if (initial && !used.has(initial)) {
      shortcuts.set(name, initial);
      used.add(initial);
    }
  }

  for (const name of names) {
    if (shortcuts.has(name)) continue;
    const key = letters(name).find(letter => !used.has(letter));
    if (key) {
      shortcuts.set(name, key);
      used.add(key);
    }
  }
  return shortcuts;
}
