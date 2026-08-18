# Wheel of Fortune

A random name picker wheel that runs entirely in your browser. Styled as a native macOS window that follows your system light or dark appearance.

## Features

- **Spin to pick**: Enter one name per line and spin. The wheel genuinely lands on the announced winner — the stopping angle is derived from the chosen index, not the other way round.
- **Turbo Play**: Draw several winners in one sequence. Each winning wedge pops out and turns gold as it is drawn. The count is clamped to the number of names on the list.
- **Sound**: Crown-style tick while spinning and a two-note chime on a win, synthesised with the Web Audio API. Silently skipped if the browser blocks audio.
- **Retina-sharp canvas**: The backing store is sized to the CSS box times the device pixel ratio and re-rendered whenever the layout changes, so the wheel stays crisp and never stretches.
- **Light and dark**: The wheel's rim, dividers, and placeholder are read from CSS custom properties and repaint when the system appearance changes.
- **Names persist**: Your list is kept in `localStorage` between visits.
- **Responsive**: Sidebar beside the wheel on a desktop, stacked with the panel folded into the title bar on a phone. The whole wheel stays on one screen either way.

## Getting Started

Open `index.html` in any browser — there is no build step and no network dependency.

To serve it locally instead:

```bash
python3 -m http.server 8000
```

## Controls

| Control | What it does |
| --- | --- |
| **Spin** | Draws a winner (or several, in Turbo Play). Locks the inputs until the animation finishes. |
| **Shuffle** | Fisher–Yates shuffle of the current names. |
| **Clear** / **Reset** | Empties the list, or restores the ten sample names. |
| **Turbo Play** | Draws several winners in one sequence. |
| Title-bar chevron | Folds the names panel away. |
| **Esc** or a click outside | Closes the winner dialog, keeping the name. |

## Self-Tests

Open `test_wheel.html` from the same server. The suite mounts `script.js` against a stand-in DOM and checks name parsing, the canvas theme bridge and its per-scheme palette cache, easing, stepper clamping, and the pointer geometry. It uses an in-memory stand-in for `localStorage`, so running it will not disturb your saved names.

## Design

Shares one design language with the other Micro Apps ([QR Generator](https://github.com/fanbigg/qr-generator) and [Event Formatter](https://github.com/fanbigg/whatsappFromatizer)): a simulated macOS window with a traffic-light title bar, one shared set of light/dark colour tokens that follow the system appearance, and the same button, input, and phone-layout rules. The shared block is marked `shared macOS app shell` in `styles.css` — edit it in one app and copy it to the others rather than letting them drift.
