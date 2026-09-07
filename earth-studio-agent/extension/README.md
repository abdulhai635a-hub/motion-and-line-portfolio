# Loading this extension

If you have loaded this before, press the extension's ↻ **reload** button after
pulling - it now asks for one more permission, and Chrome only reads that on a
reload.

1. Open **chrome://extensions**
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this folder
4. Open your project at **earth.google.com/studio**
5. Click the extension's toolbar button, type your command, press **Write keyframes**

When you press **Write keyframes**, Chrome shows a bar saying the extension
**started debugging this browser**. Leave it alone until the run finishes -
that channel is how the keyframes get written. Earth Studio's value fields
ignore events made in JavaScript, so the extension asks Chrome to deliver real
ones; dismiss the bar and the run has nothing left to write with. The extension
lets go as soon as the run is over.

Type the command in any language. Leave **Settings** alone: the move length, the
tilt and the lens are worked out from what you wrote - `slowly`, `for 6 seconds`,
`tilt 45`, `field of view 30` all steer them - and a box you fill in there forces
that one value on every step instead.

`content.js`, `panel.js`, `background.js` and `agent.js` are built from
`../src/` — run `npm run build:extension` after changing anything there.
