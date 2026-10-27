# Source and reference workspace

The user selected Open Design Option 1 and authorized implementation. Reference:
`macbook-balanced.html` in this chat's visualization folder. Mobile readability
is also in scope, with Open Design consultation underway.

## Accepted design and approaches

Option 1 places a content-sized source editor, attached Paste/Clear/context
controls and a separate scrollable Notes region on the left. Translation,
Copy/Listen, refinements and alternatives stay on the right. The source caps
its height for long input so notes retain readable space. Option 2 put notes
below both panes; it was rejected because short windows push them below view.
A's dark palette and contained reading width stay.

Copy/Listen form the action group. Part of speech appears in dictionary data,
not beside actions. The copy shortcut belongs inside Copy on desktop and in
its tooltip. Refinements remain a separate row. Desktop notes remain open.

Retain portrait compact source, 44px icon actions, always-open alternatives,
stable landscape order, visual-viewport keyboard/pan/safe areas, applied context,
source node and cursor, early main Copy and completed alternative pronunciation.
Apply the same information hierarchy on Duo where it improves readability;
Open Design reviewed all five current Duo screenshots and recommends notes
under source in stable side-by-side layouts. Keep notes in output after
alternatives in portrait. Collapse notes at short landscape heights; open them
in taller landscape. Keyboard appearance does not move notes between panes.
Use the same tonal Paste as desktop, and keep a whole source text line visible.
Optional physical book posture follows the side-by-side policy.

Use npm only. No dependencies, paid requests, provider changes or merge.
Update existing PR6. Validate seven existing viewport sizes in both engines,
including word/sentence, long input, streaming, clear, context, safe insets and
keyboard shrink. The checked prototype is the visual reference; preserve real
streaming, dictionary lookup and pronunciation semantics.
