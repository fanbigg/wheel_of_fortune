# Wheel of Fortune

A high-performance, visually gorgeous Wheel of Fortune application built using HTML5, Vanilla CSS, and JavaScript. The interface is styled to match a premium iOS Dark Mode utility app, featuring frosted glassmorphism sidebars, bouncy micro-animations, Apple Pay-style synthesizer chimes, and a custom multi-winner Turbo Play feature.

## Features

- **iOS Dark Mode Theme:** Premium layout featuring glassmorphism sidebars, animated ambient neon glow backdrops, and spring-like button transitions.
- **Turbo Play Mode:** Spin to draw multiple winners at once. Wedges representing selected winners radially pop out by `18px` and shift to golden gradients sequentially.
- **Apple Sound Pack:** Real-time audio haptics simulating digital watch crown ticks, and twin chime sweeps on win modal alerts.
- **Responsive Layout:** Sidebar toggles slide out of view flush to the screen edge, scaling the canvas to fill the entire viewport.

## Getting Started

To run the application locally, start any simple static web server:

```bash
# Using Python 3
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your web browser.

## Self-Tests

To run the automated verification checks, open `http://localhost:8000/test_wheel.html` in your browser.
