#!/bin/sh
# Xcode Cloud post-clone hook.
# Runs inside ios/App after the repo is cloned: install JS deps and
# regenerate the Capacitor iOS project + CocoaPods workspace before
# xcodebuild starts.
set -e

# Repo root is two levels up from ios/App.
REPO_ROOT="$CI_WORKSPACE"
cd "$REPO_ROOT"

# Xcode Cloud images ship Node via the default Xcode tools; if it's not
# on PATH, install via Homebrew (available on CI images).
if ! command -v node >/dev/null 2>&1; then
  brew install node@20
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi

npm ci
npx cap sync ios

# Pods: CocoaPods is preinstalled on Xcode Cloud images.
cd "$REPO_ROOT/ios/App"
pod install --repo-update
