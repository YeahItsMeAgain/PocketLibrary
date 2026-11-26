# Update availability banner and readable release notes

**Status:** ready-for-agent
**Tracker:** local `.scratch/update-banner/`

## Problem Statement

PocketLibrary can already check for a new release, but the only sign of one lives inside Settings → Updates. Someone who never opens that screen can miss an update entirely. When they do find it, the release notes arrive as one long block of pre-wrapped Markdown — several screens of headings, paragraphs and bullets — so the one or two changes that matter are hard to spot.

The result is that a new release is technically discoverable but practically invisible, and its changelog is read as a wall of text rather than a short announcement.

## Solution

After a metadata-only update check on launch, an available release raises a compact, dismissible **“A new edition is ready”** banner above the library wall. It names the new version and shows the first few release highlights, then offers one clear action: **See update**, which opens Settings → Updates.

Settings → Updates keeps the same check/download/install flow, but presents release notes as a readable ledger: a short set of highlights, followed by an expandable **Full release notes** section. No release text is hidden from the user permanently; the full notes are simply no longer the first thing they must wade through.

The banner is quiet by default: no update, no banner; a failed check, no banner; it never downloads or installs anything. Dismissing the banner remembers that version, so it does not nag on every launch, but a future release raises the banner again.

## User Stories

1. As a reader opening the app, I want to see a small notice when a newer edition exists, so that I do not have to visit Settings to discover it.
2. As a reader, I want the notice to name the available version, so that I know what I am being offered.
3. As a reader, I want the notice to show one to three short highlights from the release, so that I can judge whether the update matters to me.
4. As a reader, I want the notice to stay compact on a phone screen, so that it does not push my shelves out of view.
5. As a reader, I want a single obvious **See update** action, so that the next step is not a guess.
6. As a reader, I want **See update** to take me straight to the Updates section in Settings, so that I do not have to hunt for it.
7. As a reader, I want to dismiss the notice without leaving the wall, so that it does not interrupt browsing.
8. As a reader, I want a dismissed version to stay dismissed for that version, so that every launch is not interrupted by the same announcement.
9. As a reader, I want the notice to return when a newer release appears, so that a later update is not hidden by an old dismissal.
10. As a reader, I want the notice removed once I am up to date, so that I never see a stale offer.
11. As a reader, I want no notice when the update check fails or the device is offline, so that a quiet failure does not become a misleading alert.
12. As a reader, I want the update check not to delay the first shelf paint, so that opening the app still feels immediate.
13. As a reader, I want only one update check per launch, so that the banner and Settings do not race each other or waste mobile data.
14. As a reader, I want the release notes in Settings to open with a short highlights list, so that I can scan the important changes first.
15. As a reader, I want to expand **Full release notes** when I want the complete detail, so that nothing is lost by the compact view.
16. As a reader, I want headings and bullets in the release notes to render as headings and bullets rather than raw Markdown symbols, so that the changelog is readable.
17. As a reader, I want the release date and size to remain visible next to the version, so that I can recognise the release I am being offered.
18. As a reader, I want the existing Download and Install buttons to remain explicit, so that the banner never makes an update feel automatic.
19. As a reader with reduced motion enabled, I want the banner to appear and disappear without animation, so that it respects my motion preference.
20. As a reader using a screen reader, I want the banner announced politely and the dismiss control labelled, so that the update does not interrupt other reading.
21. As a reader who has already downloaded the update, I want the banner to stop offering the same version and reflect that the next step is installation, so that I am not told to download twice.
22. As a reader, I want the banner to remain legible on the narrowest supported phone width, so that it does not create horizontal overflow or clip the version.
23. As a reader, I want the banner to use the room’s brass-and-aubergine language, so that it feels like part of PocketLibrary rather than a web notification.
24. As a reader, I want release notes from older manifests that have no special summary field to work, so that the feature does not depend on a server-side migration.
25. As a reader, I want a release with no notes to fall back to a simple “Release notes are available in Settings” line, so that an empty changelog never produces an empty banner.

## Implementation Decisions

- **One update check per launch.** The existing check on opening Settings is lifted into shared app-shell state so the banner and Settings consume the same `UpdateCheck` result. A check is requested soon after launch but after the first shelf paint; Settings can still trigger a manual re-check.
- **Banner placement.** The banner is part of the normal page flow at the top of the app shell, above the current view’s content and below the safe-area inset. It is not a modal, does not cover the drawer pull, and does not block the shelf.
- **Banner content.** The banner shows an eyebrow, the available version, up to three compact highlights, a **See update** action, and a labelled dismiss control. If no highlights can be derived, it shows one fallback sentence. It does not show the full notes.
- **Banner visibility.** Visible only when the check says a newer version is available, the result is for the current launch, and the stored dismissal does not match the offered version. Downloaded-but-not-installed updates keep the banner, changing the action copy to point at installation.
- **Dismissal persistence.** Store the last dismissed version in local storage, not a boolean. A different, newer version is therefore announced normally. Clearing local storage restores the banner.
- **Navigation.** **See update** closes any open drawer state as needed, switches to Settings, and focuses/scrolls the Updates section into view.
- **Release-note parsing.** Add a small pure parser for the existing Markdown-ish notes: headings, paragraphs and bullet lists. It produces safe structured blocks, never raw HTML. No new Markdown dependency is required and no manifest schema change is made.
- **Highlights extraction.** Derive the compact highlights from the first bullet list in the notes, stripping Markdown emphasis and bold markers. If there is no bullet list, use the first short paragraph, truncated at a word boundary. If neither exists, use the fallback sentence.
- **Settings presentation.** Keep version, date and size rows. Replace the single pre-wrapped notes block with a compact highlights block and a **Full release notes** expander. Expanded notes render the parsed headings, paragraphs and bullets. The current Download / Install actions and progress/error states remain unchanged.
- **UpdateCheck contract.** The existing update-check result remains the only data source. No new command, server field, or endpoint is introduced.
- **Reduced motion and accessibility.** Use the app’s existing reduced-motion rules for any entrance/exit. The banner is a polite status region, the dismiss button has an explicit aria-label, and **See update** is a real button with visible focus.
- **Visual language.** Reuse the existing brass rails, paper labels and small-caps eyebrow treatment; the banner should read as a brass notice slipped onto the wall, not a coloured alert bar.

## Testing Decisions

- **Pure release-note helpers.** Unit-test the parser and highlight extractor against: headings and bullets, bold/emphasis markers, long paragraphs, empty notes, notes with only headings, and older plain-text notes. These are pure functions with no DOM dependency, matching the existing helper-test style used for naming and search helpers.
- **Banner visibility via Playwright.** Using the existing update mock, cover: update available shows the banner with version and highlights; up-to-date shows nothing; a failed check shows nothing; a dismissed version stays hidden after reload; a newer version reappears; **See update** lands on Settings with Updates visible.
- **Single-check behavior.** Assert that a launch with the banner and then Settings open performs one automatic check rather than two. Manual **Check for updates** remains allowed.
- **Readable notes.** Assert that Settings initially shows the compact highlights, that **Full release notes** expands the complete parsed notes, and that raw `##`/`-` markers are not shown as the primary reading surface.
- **Narrow viewport.** Run the banner tests at the existing 390×844 phone viewport and assert no horizontal overflow.
- **Existing seams only.** The web `Platform` adapter and its mock remain the only UI seam; no new testing seam is introduced. The update manifest parser and verification tests in the core stay untouched.

## Out of Scope

- Automatic download or automatic installation of updates.
- Android notifications, background polling, or push messages.
- A server-published `summary` field or a change to the release-manifest schema.
- Editing or authoring release notes in the app.
- A history of previously read release notes beyond the current available release.
- Changing the APK verification, download, or installer flow.
- A “mark all updates read” setting.

## Further Notes

The complaint is about *discoverability* and *scanability*, not about hiding detail. The banner is the announcement; Settings remains the place where the full changelog lives. The design should make a release feel like a small printed notice tucked into the room, not like a persistent notification centre.
