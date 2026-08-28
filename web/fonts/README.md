# The braille typeface is missing from this repository, on purpose

`index.html` asks for **APH Braille Shadows** as `APHfont`, and the files are not
here. APH agreed that Sensory App House may *use* the face; that is not a grant
to redistribute it, and APH publish it with no licence statement at all.
`PROVENANCE.md` records the whole position, including who confirmed it and when.

**Without it** the braille pane falls back to `Apple Braille`, then
`Segoe UI Symbol`, then `monospace`. Braille still renders correctly — you lose
the faint *shadows* of the unraised dots, which is what makes the face useful to
a child learning cell shapes.

**To restore it**, put these three files in this folder:

    APH_Braille_Shadows.woff2
    APH_Braille_Shadows.woff
    APH_Braille_Shadows.ttf

and add the first two back to the `CORE` list in `Translate/sw.js`, where a
comment marks the spot. Nothing else needs changing — the `@font-face` rule in
`Translate/index.html` is already there and already names them.

Ask APH before you redistribute them yourself.
