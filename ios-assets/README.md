# `ios-assets/` — staging directory for iOS native assets

This directory holds assets that belong inside the Xcode project's
`Assets.xcassets/` once `npx cap add ios` has been run on a Mac and
the resulting `ios/` directory is committed (see
`docs/IOS_SHELL_SETUP.md`).

Keeping them here in-repo now means:

- The assets are version-controlled and reviewed alongside the code
  that depends on them (see: `src/lib/ios-shell.ts`).
- They can be regenerated deterministically from `public/icon-512.png`
  (see the `convert` invocations in the PR that introduced this
  directory — trivial to re-run with a higher-resolution source
  later).
- The user running `cap add ios` just has to copy a subtree, not
  re-generate the 18 PNGs from scratch.

## Contents

### `AppIcon.appiconset/`

All 18 icon sizes Apple requires for a universal (iPhone + iPad) app,
plus the 1024×1024 App Store marketing icon, plus `Contents.json` that
maps each file to its `idiom` + `size` + `scale` slot. All PNGs are
opaque (alpha flattened against white) — Apple **rejects** icons that
carry transparency.

**Caveat:** the 1024×1024 marketing icon was upsampled with Lanczos
from `public/icon-512.png`. It will look slightly soft at full
resolution on the App Store detail page. Replace with a native-1024
source if you have one:

```bash
# From repo root, with a 1024×1024 source at public/icon-1024.png:
convert public/icon-1024.png \
  -background white -alpha remove -alpha off \
  -strip \
  ios-assets/AppIcon.appiconset/AppIcon-1024.png
```

## Moving into the iOS project

After `cap add ios` generates `ios/App/App/Assets.xcassets/`:

```bash
# From repo root, on the Mac:
rm -rf ios/App/App/Assets.xcassets/AppIcon.appiconset
cp -R ios-assets/AppIcon.appiconset ios/App/App/Assets.xcassets/
npx cap sync ios
```

Xcode will pick up the new icon set automatically on the next build.
Verify in **Assets.xcassets → AppIcon** that every slot is populated
(no empty dashed squares).
