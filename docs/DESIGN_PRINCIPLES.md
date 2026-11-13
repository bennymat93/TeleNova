# TeleNova - design principles and binding Design Rules

Research summary for the skin (base 1920x1080, Hebrew RTL + English, D-pad remote on Android TV boxes, also PCs and
phones). Numbers marked *(conv.)* are conventions, not documented platform requirements. Sources read directly:
Google (Android TV), Apple (tvOS HIG), Amazon (Fire TV), W3C (WCAG 2.2), Netflix partner help, Kodi source files.
kodi.wiki blocked direct fetches (facts from it come from search snippets); Roku publishes no design numbers; the
competitive notes are observations, not sourced research.

## A. 10-foot UI

| Topic | What the platforms say | Source |
|---|---|---|
| Text size | tvOS: default 29 pt, minimum 23 pt (1 pt = 1 px at 1080p); body 29/36, captions 23-25, headline 38, titles 48-76. Fire TV: at least 14 sp, about 28 px at 1080p. Android TV: 960x540 dp canvas (1 dp = 2 px), no thin or decorative fonts | developer.apple.com/design/human-interface-guidelines/typography · developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html · developer.android.com/design/ui/tv/guides/styles/typography |
| Safe area | Android TV: 5 % (96 px sides, 54 px top/bottom at 1080p). tvOS: 80 pt sides, 60 pt top/bottom. Fire TV: nothing in the outer 5 %. Roku title-safe: 80 % | developer.android.com/design/ui/tv/guides/styles/layouts · developer.apple.com/design/human-interface-guidelines/layout · developer.roku.com/dev/docs/graphics |
| Focus | Android TV: scale 1.025 / 1.05 / 1.1 (smaller for larger elements), border, glow, colour - may be combined. tvOS: elevation + illumination, focused item never overlaps neighbours, focus never moves without input | developer.android.com/design/ui/tv/guides/styles/focus-system · developer.apple.com/design/human-interface-guidelines/focus-and-selection |
| D-pad | something actionable is always focused; every visible control reachable by a straight path; one focus scheme; Back goes to the previous destination, no exit confirmation, no on-screen back button | developer.android.com/training/tv/get-started/navigation |

## B. What to adopt, what to avoid (observations)

- **tvOS / Infuse / Disney+**: restrained palette, one accent, generous spacing, bright outline + slight scale. Avoid parallax, live blur, thin weights, animated brand tiles.
- **Google TV / Netflix / Plex**: continue-watching near the top, hero that follows the focused card, one focus style everywhere, progress bars on posters. Avoid promotional clutter, autoplay previews (heavy on weak boxes), secondary text below 24 px.
- **Kodi skins**: Estuary's eight `<res>` entries and performance baseline; Arctic Fuse 2's hub structure. Avoid textured backgrounds (Aeon Nox SiLVO), Estuary's 23 px smallest font and thin clock, heavy widget loads.

## C. Mature visual language

- **Contrast (WCAG 2.2)**: text 4.5:1 (3:1 for large text); non-text and focus indicators 3:1 (1.4.11); the focused item never fully hidden (2.4.11); focus indicator at least a 2 px perimeter with 3:1 between states (2.4.13). w3.org/TR/WCAG22/
- **Over artwork**: a dark scrim so that 4.5:1 holds against a white test image (60-80 % black *(conv.)*).
- **Scale and spacing**: at most 5-6 font sizes, steps of about 1.2-1.3x; 8 px grid *(conv.)*; one radius family.
- **Motion**: focus 150-250 ms, window transitions up to 400 ms, no bounce *(conv.)*.
- **What reads as childish / template**: more than one accent colour, saturated warm colours on large surfaces, thin or decorative fonts, more than one focus style, glow + scale + colour all at once, textured backgrounds, long or bouncy animation, mixed radii, mixed icon styles, centred body text, a shadow on every label.

## D. Productive UX

- **Continue watching** (Google Watch Next): a film counts as started after 3 % or 2 minutes, an episode after 2 minutes; finished when under 3 minutes remain; then the next episode, one item per series. developer.android.com/training/tv/discovery/guidelines-app-developers
- **Search**: voice where the remote has a microphone; test Hebrew input in the on-screen keyboard.
- **Context menu**: long-press, about 7 items at most, the most frequent first *(conv.)*.
- **States**: every list has a loading, an empty and an error state with one focused action. Undo before confirmation for reversible actions.

## E. Player and subtitles

- **OSD (Android TV)**: centre = play / pause, left / right = seek a step, hold = scrub, up / down = info without pausing. developer.android.com/training/tv/playback/controls
- **Netflix Hebrew timed text**: 42 characters per line, 2 lines, 17 characters per second (13 for children), proportional sans-serif, white, no italics. partnerhelp.netflixstudios.com/hc/en-us/articles/220636427
- **FCC 47 CFR 79.103(c)**: the viewer can set size (50-200 %), colours, opacity of text and background, edge style; the choice persists.

## F. Kodi specifics

- Every `<res width height aspect folder>` in `addon.xml` declares a coordinate space; Kodi scales the skin. Estuary declares 4:3, 3:2, 16:10, 17:9, 16:9, 18:9, 19.5:9, 21:9 on one `xml` folder. A skin with one aspect gets bars or stretching.
- Skin zoom (-30 %..+30 %) is the GUI's overscan control; video calibration is separate.
- `font13` is mandatory; a fontset needs `unicode="true"`; ship a font verified for U+0590-05FF.
- Label overflow: `scroll`, `scrollspeed`, `wrapmultiline`; fadelabel `scrollout` / `pauseatend`; textbox `autoscroll`.
- Kodi has no layout mirroring: the skin sets alignment and navigation order itself, by language condition.
- Performance (kodi.wiki/view/Skin_Optimizations): overdraw is the key number (target about 2.5; Estuary home about 4.2); full-screen layers cost most; diffuse is cheaper than an extra texture; label `shadowcolor` in lists is a known cost.

## Binding Design Rules

1. [text] No UI text below 24 px; body text at least 28 px.
2. [text] Secondary text 24-26 px and never the only carrier of essential information.
3. [text] At most 6 font sizes, each step 1.2x or more *(conv.)*.
4. [text] No Thin or Light weights anywhere, the clock included.
5. [text] Line height 1.2-1.3x for multi-line text.
6. [text] Every label has an explicit overflow behaviour (truncate, scroll on focus, or wrap to 2-3 lines). No clipped text in Hebrew or English.
7. [text] `font13` exists and every fontset uses a font verified to contain Hebrew.
8. [layout] All text and focusable controls inside 96 px left / right and 54 px top / bottom.
9. [layout] Backgrounds bleed to the full 1920x1080.
10. [layout] Positions and sizes are multiples of 8 px (4 px for fine detail) *(conv.)*.
11. [layout] At least 40 px between cards in a row; a focused card never covers a neighbour's text.
12. [layout] `addon.xml` declares `<res>` for 16:9, 16:10, 4:3, 18:9, 19.5:9, 21:9 and the layout passes at each.
13. [layout] The layout stays usable at skin zoom -10 % *(conv.)*.
14. [layout] One corner-radius family, at most 2 values *(conv.)*.
15. [focus] Exactly one focus style skin-wide, built from at most 2 cues.
16. [focus] Focus scale 1.025-1.10, smaller for larger items.
17. [focus] Focus outline at least 4 px with 3:1 contrast against card and background *(conv.; WCAG floor 2 px)*.
18. [focus] The focused item is never fully hidden.
19. [color] Body text contrast at least 4.5:1; large text at least 3:1.
20. [color] Text over artwork sits on a scrim such that 4.5:1 holds against a white image.
21. [color] One accent colour; no saturated red or orange on large surfaces.
22. [motion] Focus transitions 150-250 ms, window transitions 400 ms or less, no bounce *(conv.)*.
23. [nav] Every window opens with a focused actionable control, empty and error states included.
24. [nav] Every visible control is reachable by D-pad; Back always leaves.
25. [nav] Returning to a list restores the previously focused item *(conv.)*.
26. [nav] Back never asks for confirmation except on destructive actions.
27. [nav] A continue-watching item plays within 3 presses from home *(conv.)*.
28. [nav] Continue watching is home row 1 or 2; items appear after 2 minutes watched and leave under 3 minutes left.
29. [player] Centre = play / pause, left / right = seek, up / down = info; the OSD hides within 5 s *(conv.)*.
30. [player] Audio and subtitle selection at most 2 presses from the OSD *(conv.)*.
31. [subs] Default subtitles: white sans-serif with Hebrew coverage, centred at the bottom, at most 2 lines, about 42 characters across.
32. [subs] Subtitle settings expose size, colour, background / edge style and opacity, and they persist.
33. [rtl] In Hebrew, alignment, row direction and left / right targets are mirrored by language condition; no screen with mixed alignment.
34. [rtl] Strings mixing Hebrew with numbers or Latin text are tested on every screen.
35. [perf] At most 2 full-screen layers per window; no label `shadowcolor` in lists; background textures no larger than needed.

**Open before the rules are frozen**: Android TV's numeric type scale and Material motion tokens (pages did not render), direct reads of kodi.wiki.
