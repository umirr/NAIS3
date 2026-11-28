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

The Android host uses Capacitor 8.6.3 with native encrypted workspace snapshots,
persisted folder access, and a foreground generation service. The service journals jobs
and downloaded image receipts independently of the WebView. Restart restores unfinished
jobs as pending; an explicit generation action resumes them. Completed receipts are
reconciled into the image catalog without duplicate records. Scene notifications follow
successful catalog persistence. Bottom navigation and the single-image scene viewer are
connected to the renderer. This remains an incomplete development application.

Android overrides generation and account requests with native networking. Tag search
uses the bundled PC tag list and shared search rules in a Web Worker, with retry after
asset loading failure. Token counting is not yet connected locally.
References, image-to-image and reserved scene generation are explicitly blocked until
their native paths are implemented. The browser JSON backup is not PC-compatible and
is not exposed by the Android storage settings.

## Required next work

- Verify native service lifecycle and downloaded-receipt recovery on Android, including
  process termination, revoked folder access, full storage and foreground timeouts.
- Implement native enforcement of the existing spending guards before distribution;
  their presence in reused settings does not establish native enforcement.
- Connect token counting, references and scene export/reserved generation.
- PC .nais manifest/table/asset/checksum compatibility, validated before import mutation.
- Wire mobile pages and make editor, settings, scene controls and library touch usable.
- Keyboard/insets/back handling, real-device interaction tests, Android packaging.
- Replace generated host icons and verify license/source availability for packaged builds.

The mobile branch includes PC commit 11d8236 and its prompt-selection fixes.

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

- Nineteen focused tests: recovery/persistence failure/serialization, navigation draft
  preservation, single image selection identity when images are prepended, scene-link
  identity and retained image records after configuration restore, portable archive
  compatibility, durable scene notification without duplicate completion records,
  bundled tag search/retry, portable decoding and non-mutating workspace conversion.
- Renderer TypeScript check passed.
- Tests currently use the previously installed local dependency tree (Vitest 3.2.6),
  not a new installation of the package versions declared by this checkout.
- Android compilation, lint, renderer checks and twelve tests passed in workflow run
  46077905662 for commit de4d8f7; its development APK is a CI artifact.
  No device verification or authenticated generation.
- No full Android-to-PC/PC-to-Android workspace backup round-trip yet.
- Portable .nais export codec passes three compatibility tests against the unmodified
  PC archive reader: settings/scene rows and reference/library assets round-trip,
  missing assets are rejected, and altered image bytes fail PC checksum validation.
  The unused PC filesystem writer is mocked in these tests; the archive reader is real.
  This is codec validation, not full database restore or Android file-picker validation.
  The current codec buffers archive assets; a streaming native implementation is still
  needed for large mobile libraries before production integration.
- Local browser preview could not be reached by the browser tool (connection timeout).
- Native packaging runs in GitHub Actions with Java 21 and the Android SDK; no local
  Android Studio/SDK installation or APK installation was performed.

## Paused checkpoint (2026-11-28)

At the user's request, stop after completing the current backup decoding and workspace
conversion unit. The portable reader validates checksums, format, paths and table rows.
The pure restore converter requires already-staged image locations, preserves accounts,
unrelated preferences and generated files, and retains scene links only for matching
id/creation-time identities. Original PC columns and binary values are retained in a
JSON-safe sidecar for future export; an export mapper is not yet implemented.

This checkpoint is not connected to the Android picker, streaming asset importer,
atomic snapshot commit or backup UI, and is not included in the above APK. Do not claim
full backup restoration is available. Resume only when the user requests it.

## Resumed native backup staging (2026-11-28)

Native archive selection and streaming validation are implemented in NaisBackupPlugin.
Image assets stay on disk; checksum, path, size, table and duplicate-id validation happen
before the bridge returns metadata. Stage decoding tests pass. This is not connected
to a restore button yet. The destination policy for restored library assets needs user
confirmation before committing files to the selected library folder. The earlier pause
was lifted by the user. Atomic workspace commit and export mapping remain outstanding.


## Backup import screen connected (2026-11-28)

The user selected restoration under the configured library folder. Import now stages
new library images in a unique subfolder and preserves reference assets privately.
Settings show a validated-backup confirmation before replacement. The serialized workspace
write captures an encrypted before-import snapshot before the atomic replacement.
Pending/failed/running generation jobs block restoration. A reload hydrates stores after
success. Library view includes restored catalog images. Device picker/storage/recovery
verification, cleanup of uncommitted library folders after a later snapshot failure,
and backup export remain outstanding. A failed post-copy commit can leave a new restore
subfolder, but does not overwrite existing files or mark workspace restoration complete.

