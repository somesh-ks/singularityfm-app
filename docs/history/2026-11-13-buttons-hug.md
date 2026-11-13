# Buttons hug their words (2026-11-13)

The owner, with a phone screenshot: "why are the FAB button, chapter play buttons not hugging the text? The button resizing problem should be fixed by keeping the icon size same and not by hardcoding the button size." Then: "the play button in the hero should be just the icon button, and the same in chapters"; "in general buttons should hug text".

- Cause: DS-9 (2026-11-10) answered "no jerks" by reserving the widest words a control might say (`reserve`), on top of the chip's old 7rem floor. A story's "0:22" sat in a pill as wide as "Play again"; the floating Play's words in one as wide as "Resume · 88 min left". A fixed width by another name.
- Fix (library DS-13): a control hugs its words; only the glyph slot is fixed. `reserve` is deprecated, the 7rem floor and the "Play again" hover words are gone, chip digits are tabular in every state. PlayChip with no label is its glyph alone, as tall as the chip. The drift test checks hugging.
- App: the hero's and each story's Play draw PlayChip with no label; readerSync writes the name of a glyph-only chip, which carries what the words said; Library and admin Costs selects drop `reserve`. Tests that read the chip's words read its name.
- Lesson: a box that holds still and a box with empty room are different asks. Fix icon swaps with a fixed slot; remove changing words rather than reserving room for them.
