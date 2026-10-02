# Character, NPC and chat design

Compared the original `D:/projects/rpg/rpg_fe/src/pages/Play.jsx` and
`src/components/JsonViewer.jsx` with the local app. The original provided separate
character sections, collapsible NPC entries and a bounded conversation with player
messages on the right and GM messages on the left.

## Changes

- Campaign navigation now includes a dedicated NPCs view. NPC entries expand to show
  skills/attributes, inventory, description, notes and the existing editing controls.
- Player characters remain in Characters. Their sheets use the same section navigation.
  Nested objects and arrays render as labeled rows and lists rather than JSON strings;
  Advanced JSON editing remains available.
- Chat uses a scrollable conversation, opposing message bubbles, author labels and
  timestamps. It follows new GM messages when the reader is near the bottom, leaving
  their position alone when they scroll back. Dice, evidence, state changes, retries,
  undo, dictation and read-aloud remain in the play view.
- Character editors stay mounted across category changes to preserve unsaved edits.
  Roles are identified through backend settings rather than a duplicate role catalog.

## Verification

46 frontend unit tests passed. Six Windows Chrome browser tests passed, covering
imports, source correction, play/undo, message layout, NPC expansion, sheet sections,
draft preservation and horizontal overflow at 320–2560px. Frontend ESLint, TypeScript
and production build passed. The desktop chat screenshot was visually inspected.
These UI checks mock API boundaries; they do not consume live AI quota or establish
phone compatibility. No database schema change is needed.

## Section editing follow-up

Skills/Attributes, Inventory and Description now each replace their formatted display
with a JSON editor when Edit JSON is selected. View returns to saved data while keeping
unfinished text. Saving patches only the chosen section and returns to its formatted
display for players and NPCs. Each draft captures its originating campaign revision;
refreshes do not silently advance it. Invalid JSON or a failed/conflicting save keeps
the editor and text intact. Reload current section explicitly discards the draft.
Name/notes editing no longer resubmits potentially stale attributes or inventory.

Verified 48 frontend unit tests and six Windows Chrome browser tests, including real
view/edit/save interactions for both character categories with mocked API boundaries.
Frontend lint, formatting and production build passed.
