# live deployment
https://12334Bruno.github.io/lidl-split

## Percentage splits

Tap an item's **%** button to share its cost unevenly. Two people use one slider; larger groups get a percentage box and slider for each person. Sliders move in steps of 1%. You can also type percentages, including up to two decimal places.

Slider handles are taller for easier dragging. On Android browsers with vibration support, including Brave, dragging requests short 20 ms ticks, spaced at least 80 ms apart. A blocked request is retried once when the finger lifts. Device and browser settings can still silence vibration.

On iPhones and iPads with native switch support (iOS 18+), a small, invisible native switch over each handle supplies iOS's own feedback during a real drag. This is an experimental workaround adapted from [ios-vibrator-pro-max](https://github.com/samdenty/ios-vibrator-pro-max); it does not wrap the page or replace other controls. Actual iPhone vibration still needs a physical-device check, especially after iOS updates. Reduced-motion preferences disable both feedback paths. Other browsers keep normal sliders. Keyboard and screen-reader users retain the original range control.

Each person’s current euro share stays visible while you edit, even when the percentages total less or more than 100%. Tap **Normalize** inside the open controls to keep the current proportions and round them to whole percentages totaling exactly 100%. If all shares are zero, Normalize divides them evenly. The total must reach 100% before you can tap **Done**.

This browser remembers each item's percentage option and values by item name for future receipts. Tap **%** again to turn it off and keep the values for later. Choosing a person or Common switches the item back to an ordinary assignment.

Run the calculation and receipt tests with `npm test`.

For the mobile, desktop, and iPhone-engine browser tests, run `pnpm install`, `pnpm exec playwright install --with-deps chromium webkit`, then `pnpm test:browser`. The browser tests start a local preview using Python 3. To check the published site instead, run `LIDL_TEST_URL=https://12334bruno.github.io/lidl-split/ pnpm test:browser`. Automated checks verify slider behavior and vibration requests; they cannot prove that a phone's motor responds.

## to do more changes, either:
- use [repomix](https://github.com/yamadashy/repomix), upload that (contains `test-generation-guidelines.md`)
- or, upload `index.html` and all the `.js` files in `src/` to claude
	- if you're having it write tests (good idea), upload all files in `test/` as well as `test-generation-guidelines.md`
