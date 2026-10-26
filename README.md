# live deployment
https://12334Bruno.github.io/lidl-split

## Percentage splits

Tap an item's **%** button to share its cost unevenly. Two people share one slider that balances their shares to 100%; larger groups have independent controls for each person. Sliders move in steps of 1% with touch or mouse. Typed values support up to two decimal places.

On the assignment screen, use a person's initial to assign the focused row; **C** assigns Common. Collisions use the next available letter in the name, preserving other people's initials. Hover an assignment button to see its shortcut. Assignment shortcuts move down one row. **↑/↓** navigate rows and each open slider in order, keeping focus visible. **%** toggles the focused row's percentage picker. **?** opens a Google Images search for its item name in a new tab. On mobile, hold an item for 600 ms and release to do the same. **←/→** change the focused slider (or the first person's share when a row is focused) by 5%. With two people, these keyboard changes adjust the other share to total 100%. Shortcuts pause while typing or editing settings.

Each person’s current euro share stays visible while you edit, even when the percentages total less or more than 100%. Tap **Normalize** inside the open controls to keep the current proportions and round them to whole percentages totaling exactly 100%. If all shares are zero, Normalize divides them evenly. The total must reach 100% before you can tap **Done**.

This browser remembers each item's percentage option and values by item name for future receipts. Tap **%** again to turn it off and keep the values for later. Choosing a person or Common switches the item back to an ordinary assignment.

Run the calculation and receipt tests with `npm test`.

For the mobile, desktop, and iPhone-engine browser tests, run `pnpm install`, `pnpm exec playwright install --with-deps chromium webkit`, then `pnpm test:browser`. The browser tests start a local preview using Python 3. To check the published site instead, run `LIDL_TEST_URL=https://12334bruno.github.io/lidl-split/ pnpm test:browser`.

## to do more changes, either:
- use [repomix](https://github.com/yamadashy/repomix), upload that (contains `test-generation-guidelines.md`)
- or, upload `index.html` and all the `.js` files in `src/` to claude
	- if you're having it write tests (good idea), upload all files in `test/` as well as `test-generation-guidelines.md`
