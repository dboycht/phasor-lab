# Phasor Lab · 相量计算器

A phasor / complex-number calculator built for AC circuit analysis, with a
GeoGebra-style two-pane layout and a **live phasor diagram**.
Ordinary calculators cannot even type phasor notation; this one is built around it.

一个为**交流电路分析**而生的相量与复数计算器，采用 GeoGebra 风格双栏界面，右侧**实时绘制相量图**。
普通计算器连相量记号都打不出来，这个工具就是围绕它设计的。

![Phasor Lab, Chinese UI](docs/screenshot-zh.png)

---

## Why another calculator

* **Type phasors the way textbooks write them** — `220\angle 30\degree`, `3+4j`,
  `220e^{j30\degree}`, `5(\cos 53\degree + j\sin 53\degree)`.
* **Name things** — `U=220\angle 30\degree\text{V}`, then `I=U/Z`.
  Subscripts work: `U_1`, `X_{L}`.
* **See it** — every visible object is drawn as an arrow; phase angles get an arc
  marker; drag an arrow tip to change the value.
* **Get the numbers you need** — modulus, argument, real part, imaginary part,
  conjugate, both RMS and amplitude forms.

## Features

| | |
| --- | --- |
| Four input forms | polar, rectangular, exponential, trigonometric (mix them freely in one expression) |
| Named variables | definitions resolve in **any order** — `I=U/Z` may come before `U` and `Z` |
| Auto-naming | an expression you did not name becomes `A`, then `B`, … `Z`, `A1`; a name is reused once its object is gone |
| Names as you write them | `U1`, `I2`, `T0` are read as subscripts (`U_1`, `I_2`, `T_0`), and so are `U_1` and `X_{L}` |
| Functions | `\abs \arg \conj \Re \Im \polar \rms \peak \om \freq \pf \todeg \torad`, `sin cos tan`, `asin acos atan atan2`, `ln log log2 exp`, powers, n-th roots, `floor ceil round` |
| Symbol keyboard | three labelled groups — symbols, units, functions — with the function group foldable; hovering a key explains it with a worked example |
| Live diagram | grid, axes, coloured arrows, labels, phase-angle arc, optional sum polygon, PNG export |
| Direct manipulation | drag a tip to edit the phasor, wheel to zoom, drag the background to pan, double-click to fit |
| Edit again | double-click an object to load its own source back into the input box |
| Recall input | press ↑ in an empty input box to walk back through what you typed before |
| Copy a result | click any line of the result card to put that number on the clipboard |
| Compare two quantities | pick A and B: `A/B` is the impedance when A is a voltage and B a current, `A·conj(B)` is the complex power, plus Δφ and cos Δφ |
| Worked examples | five classic setups (series RLC, power factor, three-phase star, parallel branches, a KVL loop) load with one click |
| Undo / redo | every change, including settings, angle-unit switches and the convention conversion |
| Never lose work | the project is saved in the browser as you type, and can be exported / imported as JSON |
| Angle units | degrees (default) or radians, switchable at any time |
| Phasor convention | RMS (default) or amplitude, with an explicit *convert all* action |
| Bilingual UI | 中文 / English, switchable at runtime |
| About dialog | the `ⓘ` button shows the version, the repository and what the app is built on |
| Linear equations | an equation card solves `2x+6=0` or a system `3x+4y=10; x-y=1` (up to three unknowns, complex coefficients), shows the decimal **and** the exact fraction, substitutes the answer back, and stores every unknown as a phasor you can draw |
| Engine | [mathjs](https://mathjs.org) for evaluation, [MathLive](https://mathlive.io) for input |

### Drag to edit

Drag the tip of an arrow to set a new value. `Shift` keeps the magnitude and only
changes the angle, `Alt` keeps the angle and only changes the magnitude, and the
**15° snap** toggle rounds the angle to a multiple of 15°.
The object's expression is rewritten to match, in the same form you typed it.

### Sums, KVL and KCL

Turn on **sum** in the graphics toolbar and the visible phasors are also drawn
head-to-tail, with the resultant labelled `Σ = …`. That single picture covers
both laws:

- **KVL** — around a loop the drops add up to the source. Load the *Series loop
  KVL* example: `U_R = 60∠0°`, `U_L = 80∠90°`, `U_C = 40∠−90°`, and the chain
  closes on `U = 60 + 40j = 72.11∠33.69°`.
- **KCL** — at a node the currents sum to zero, so hide everything except the
  branch currents and the resultant should land on the origin.

### Solving equations

The **Equations** card at the bottom of the algebra view solves first-degree
equations, with a system separated by semicolons:

| What you type | What you get |
| --- | --- |
| `2x+6=0` | `x = -3` |
| `3x=1` | `x = 0.333333`, exact `1/3` |
| `3x+4y=10; x-y=1` | `x = 2`, `y = 1` |
| `(3+4j)I1+2I2=10; 2I1+(5-j)I2=0` | a complex pair — mesh analysis, in one line |
| `Z*I=U` (with `Z` and `U` already defined) | `I = U/Z` |

Up to three unknowns. The answer is shown as a decimal and, when it is a simple
ratio, as an exact fraction; every equation is then **substituted back** with its
residual, and each unknown is stored as a phasor object — so it appears in the
algebra view, can be dragged in the diagram, and can be used by later
expressions.

It refuses to guess: a quadratic (`x^2=4`), a product of unknowns (`xy=6`), a
contradictory system (`x+y=1; x+y=2`), a system that is not independent, or more
than three unknowns all produce a sentence explaining what is wrong instead of an
answer.

## Quick start

**On Windows, just double-click `start.bat`.** It installs the dependencies and
builds the app the first time (that needs the network once), then serves it at
http://localhost:4173/ and opens your browser. Keep its window open while you
use the app; `start.bat build` forces a rebuild after you change the code.
If the app is already being served on that port, it simply opens the browser
instead of starting a second copy.

By hand, the app is a static site — everything under `dist/` is the whole program:

```bash
npm install
npm run dev        # development server
npm run build      # type-check + production bundle into dist/
npm run preview    # serve the built bundle
npm test           # unit tests
```

Then open the printed URL.

### Desktop app (Windows)

The same code also builds a self-contained window with [Tauri v2](https://tauri.app),
so there is no browser and no server to keep open:

```bash
npm install
npx tauri build --no-bundle      # -> src-tauri/target/release/phasor-lab.exe
npx tauri build                  # also produces an NSIS installer
```

The executable embeds the whole front end; it only needs the **WebView2 runtime**,
which ships with Windows 10/11 (and is installed by Edge). Building it needs the
Rust toolchain plus the MSVC build tools once. The installer
(`…\bundle\nsis\Phasor Lab_<version>_x64-setup.exe`, ~1.7 MB) installs for the
current user only, and it is **not code-signed** — Windows SmartScreen will ask
for confirmation the first time you run either file.

## Syntax reference

| What | How to type it |
| --- | --- |
| Polar | `220\angle 30\degree` or `220\angle 30` (bare number = current angle unit) |
| Rectangular | `3+4j` |
| Exponential | `220e^{j30\degree}` |
| Trigonometric | `5(\cos 53\degree + j\sin 53\degree)` |
| Definition | `U=220\angle 0\degree\text{V}` — the trailing unit is a display label |
| Several at once | `U=10;Z=2;I=U/Z` |
| Modulus / argument | `\abs(Z)`, `\arg(Z)` |
| Conjugate | `\overline{Z}` or `\conj(Z)` |
| Any phasor from parts | `\polar(220, 30)` |
| Angle of a ratio | `\atan2(y, x)` |
| Amplitude ⇄ RMS | `\peak(x)`, `\rms(x)` |
| Angular frequency | `\om(50)` = 314.16, and back with `\freq(314.16)` = 50 |
| Power factor | `\pf(53.13\degree)` = 0.6 |
| Explicit angle conversion | `\todeg(\pi)` = 180, `\torad(180)` = π |
| Logarithms and powers | `\ln(x)`, `\log(x)` (base 10), `\log2(x)`, `\exp(x)`, `2^10`, `\sqrt[3]{8}` |
| Rounding | `\floor(2.7)`, `\ceil(2.1)`, `\round(2.5)` |
| Grouping | `\left( ... \right)` — the `( )` key inserts it with the caret inside |
| Auto-named | `220\angle 30\degree` with no name becomes `A=220\angle 30\degree` |
| Subscripts | `U_1` or just `U1` — a single letter followed by digits is a subscripted name (`U1` = U₁, `T0` = T₀). `3+j4` (imaginary unit) and `2e3` (a number) are unaffected |

A trailing `\text{...}` group is a **display label**, not part of the number:
`U=220\angle 0\degree\text{V}` shows as 220 V. Any label works (`\text{\Omega}`,
`\text{k\Omega}`, `\text{\mu F}`, or something entirely your own), and it never
affects the arithmetic.

The angle sign takes a magnitude on its left. When the left side is itself a
phasor, it is **rotated** instead: `A\angle 30\degree` is `A` turned 30° further
(`A · 1\angle 30\degree`). For a plain magnitude the two readings coincide, so
`220\angle 30\degree` is unchanged, and `-5\angle 30\degree` still lands on the
opposite ray. `\polar(r, \theta)` always uses the *size* of `r`, which is what
"modulus and angle" means.

### The angle model

Three rules, and everything else follows:

1. Expressions are evaluated in **radians** internally.
2. A **bare number in an angle position** (`220\angle 30`, `\sin 30`) is read in
   the current angle-unit setting; the `°` sign always means degrees.
3. **Angle-valued results** (`\arg`, `\asin`, `\atan`, …) come back in the current
   angle unit, so they compose with bare values — `\phi = \arg(Z)` followed by
   `220\angle \phi` does what you expect in either unit.

Changing the angle unit re-reads every stored expression, so `220\angle 30` really
does change meaning between degree and radian mode (that is the point).

### Names

A run of letters is a product of single-letter variables (`abc` = a·b·c), except
for known function words (`abs`, `arg`, `conj`, …) and known constants
(`pi`, `e`, `i`, `j`, plus Greek names like `omega`). `U_1` and `X_{L}` are single
symbols.

## Verification

`npm test` runs 253 unit tests: the LaTeX converter, the whole documented syntax
table (four input forms, the angle model, naming, unit labels, the convention
factor and twelve rejected inputs), the session model including undo/redo,
auto-naming and project round-trips, the diagram geometry, the two-phasor
comparison, the keyboard tables, and every shipped example (which is evaluated
and compared against the textbook answer).
The UI itself is checked in a real browser: a headless-Chrome harness drives the
page through its public handle, asserts on computation results and DOM state,
samples canvas pixels to confirm the arrow and the sum polygon are drawn where
they should be, and exercises drag-to-edit, zoom, pan, hide/delete, undo/redo,
input recall, copy-to-clipboard, the example picker, the comparison card, the
keyboard groups and their hints, auto-naming, the help dialog, a phone-width
layout, reload persistence and project export/import (84 checks). It also checks
that nothing rendered from LaTeX leaks its own source - across the key labels,
the hint examples, the algebra rows and the input box itself - and that hovering
every key moves nothing on the page, which is how several keyboard keys got
caught showing `\abs(` instead of the symbol.

## Browser support

Any current Chromium, Firefox or WebKit build. MathLive ships its own fonts, so
no network access is required at runtime.

## License

MIT — see [LICENSE](LICENSE).

Bundled third-party software: [mathjs](https://mathjs.org) (Apache-2.0),
[MathLive](https://mathlive.io) (MIT), [KaTeX fonts](https://katex.org) (MIT).
