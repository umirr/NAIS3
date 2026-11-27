# Android implementation

## Agreed behavior

- Independent Android APK, initially validated on Galaxy S21 / Android 15.
- Basic generation and settings, PC-compatible backup import/export, scenes and library.
- Bottom navigation: generation, scenes, library, settings. No director or web page.
- Scene images: one centered image, previous/next buttons.
- Library connects directly to a user-selected shared-storage folder.
- Main and scene generation write to their configured output folders.
- Scene export asks for a destination separately.
- Backup restoration replaces configuration/presets/scenes, not generated image files.
  Preserve existing output folders and image catalog; restore links to existing images.
  Do not import or export generated image bytes as part of workspace backup.
- Navigation, backgrounding and screen lock must not intentionally stop generation.
- After process termination/restart, restore incomplete work as pending. Resume only on
  the user's generation action. Never automatically submit requests during recovery.
- Mark completion only after image bytes and the catalog record have been saved.
- A request interrupted after submission may have incurred a server charge even if its
  result was not received. Preserve that distinction in restored pending work.

## Current implementation status

The mobile queue persistence contract and recovery logic, bottom-navigation component,
and single-image viewer component exist with focused tests. The renderer can select the
mobile layout with VITE_MOBILE=1: bottom navigation, settings page, and single-image
scene view are connected to existing UI components. This still uses the development
browser backend and is not a functioning independent Android application. No APK exists.

The existing browser runtime relies on the Node development gateway for generation;
it is not a standalone mobile backend. Its NAIS3-web JSON backup is not the PC .nais
archive format and must not be exposed as a PC-compatible backup.

## Required next work

- Select and implement Android hosting and the native runtime bridge.
- Durable native queue/image catalog; reconcile saved image receipts after a crash
  between saving a file and recording queue completion.
- Native request execution and foreground lifecycle, explicit stop/recovery on platform
  timeout, no automatic retry of ambiguous paid requests.
- Persisted Storage Access Framework folder grants; handle revocation and full storage.
- PC .nais manifest/table/asset/checksum compatibility, validated before import mutation.
- Wire mobile pages and make editor, settings, scene controls and library touch usable.
- Keyboard/insets/back handling, real-device interaction tests, Android packaging.
- Bring the latest released prompt selection fix into the mobile branch before release;
  the initial local base is 1cc9009, not the newer release commit 11d8236.

## Backup restore semantics

The user confirmed configuration recovery, not a merge that duplicates presets. Generated
images remain in their configured folders and should be linked again after restore.
The inspected PC implementation captures existing image-to-scene catalog links before
restoration and restores those whose scene id and created_at still match. It does not
establish arbitrary folder-only reconstruction when the entire image catalog is lost.
Keep that distinction explicit when implementing mobile recovery; verify any folder scan
and embedded metadata support before claiming that a lost catalog can be reconstructed.

Final user decision: PC compatibility takes priority over backup size. Preserve the PC
.nais format and include reference, vibe and library image assets, as the PC exporter
does. Generated history remains excluded. The proposed link-only backup format is
cancelled; do not introduce a mobile-only archive variant or change the PC importer.

## Validation so far

- Seven focused tests: recovery/persistence failure/serialization, navigation draft
  preservation, single image selection identity when images are prepended, scene-link
  identity and retained image records after configuration restore.
- Renderer TypeScript check passed.
- Tests currently use the previously installed local dependency tree (Vitest 3.2.6),
  not a new installation of the package versions declared by this checkout.
- No Android build, device verification, authenticated generation or backup round-trip yet.
- Portable .nais export codec passes three compatibility tests against the unmodified
  PC archive reader: settings/scene rows and reference/library assets round-trip,
  missing assets are rejected, and altered image bytes fail PC checksum validation.
  The unused PC filesystem writer is mocked in these tests; the archive reader is real.
  This is codec validation, not full database restore or Android file-picker validation.
  The current codec buffers archive assets; a streaming native implementation is still
  needed for large mobile libraries before production integration.
- Local browser preview could not be reached by the browser tool (connection timeout).
- Android SDK, Android Studio and Java were not found at the standard checked paths
  or in the earlier PATH inspection. Native build tooling still needs provisioning.
