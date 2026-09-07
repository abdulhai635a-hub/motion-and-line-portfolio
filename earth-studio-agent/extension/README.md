# Loading this extension

1. Open **chrome://extensions**
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this folder
4. Open your project at **earth.google.com/studio**
5. Click the extension's toolbar button, type your command, press **Write keyframes**

Type the command in any language. Leave **Settings** alone: the move length, the
tilt and the lens are worked out from what you wrote - `slowly`, `for 6 seconds`,
`tilt 45`, `field of view 30` all steer them - and a box you fill in there forces
that one value on every step instead.

`content.js`, `panel.js`, `background.js` and `agent.js` are built from
`../src/` — run `npm run build:extension` after changing anything there.
