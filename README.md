# Abyssal Weight

A pixel-art vertical-extraction roguelite about descending light, choosing how deep greed takes you, and carrying your haul back through a much deadlier ascent.

## Play online

[Play Abyssal Weight on Vercel](https://abyssal-weight.vercel.app)

## Run locally

No build step or package installation is required. From the project directory, run:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your browser. Keep the terminal open while playing; press `Ctrl+C` there to stop the server.

## Controls

| Action | Controls |
| --- | --- |
| Move | `WASD` or arrow keys |
| Aim | Mouse |
| Attack / parry on a weapon clash | Left mouse button or `J` |
| Block / perfect block at impact | Right mouse button or `K` |
| Dodge | `Space` or `Shift` |
| Interact | `E` |
| Basin choices | `1` balloon, `2` descend, `3` shoulder burden |
| Surface upgrades / route | `1`–`4` purchase, `R` change unlocked route |
| Pause | `Esc` |
| Mute / unmute | `M` |

## The great cycle

Descend through the chasm while light and agile, fighting enemies and kicking treasure into each floor's basin. At a basin, choose whether to continue deeper or shoulder everything collected so far. Once burdened, climb back through altered floors and unavoidable Tax Collectors. Only loot carried all the way to the Surface is fully extracted.

Weight changes combat: a light explorer can rely on fast, invulnerable dodges, while a heavily loaded one must lean on precisely timed perfect blocks and high-risk parries. Loot balloons offer an emergency extraction at a steep value penalty.

Successful extractions award Grit for permanent Surface upgrades, including better balloon retention, encumbered stamina recovery, wider perfect-block timing, and new starting weapons. Progress is stored by the browser; clearing site data resets it.

## Browser requirements

Use a current release of Chrome, Edge, Firefox, or Safari with JavaScript, Canvas, and Web Audio enabled. The first click or keypress unlocks browser audio. Keyboard and mouse are recommended; movement, combat, dodge, and interact controls appear automatically on touch-first devices.

## Credits

See [CREDITS.md](CREDITS.md) for art licensing and audio attribution.
