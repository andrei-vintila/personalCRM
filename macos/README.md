# PRM for Mac

A native SwiftUI client for the same self-hosted backend. It uses the REST API with an API token, and has built-in calls and WhatsApp sync that replaces the Node connector.

- **Layout:** three columns like Mail. Sections (Home, Contacts, Reminders, Duplicates, Calls & WhatsApp), then a list, then the selected contact.
- **Contacts:** search, filters and tags, star and archive, create and edit, merge, delete.
- **Contact page:** contact details, tags, notes, keep-in-touch status, reminders, a log-interaction composer, and the timeline.
- **Duplicates:** groups with per-person "Not This Person", match reasons in a popover, and a merge sheet with per-field choices.
- **Calls & WhatsApp:** reads the local call history and WhatsApp store (Full Disk Access) every 30 minutes while the app runs, with the same rules as `connector/mac-sync.ts`. WhatsApp sync is metadata only; message text is never read.

## Build

Requires Xcode (the Command Line Tools alone can't compile SwiftUI's `@State` macro).

```bash
brew install xcodegen
cd macos
xcodegen            # generates PRM.xcodeproj from project.yml
open PRM.xcodeproj
```

Or from the command line:

```bash
xcodebuild -project PRM.xcodeproj -scheme PRM -configuration Release -derivedDataPath build
open build/Build/Products/Release/PRM.app
```

Without Xcode you can still type-check everything with `./typecheck.sh`.

To install PRM in `/Applications` (and update it after changes), run `./install.sh`. It builds a Release app, quits the running copy and replaces it. Each new build is a new ad-hoc signature, so macOS may ask once to allow Keychain access, and you may need to re-add PRM under Full Disk Access.

For development against a local server, `./dev-run.sh [server] [password]` builds a Debug app and launches it with a fresh token passed in through the environment. Debug builds only; the token stays in memory, never in the Keychain.

## Sign in

Enter your server address and app password. The app signs in once, creates its own API token ("Mac app on <your Mac>") and keeps it in the Keychain; the password isn't stored. Revoke the token under Settings → API tokens on the web to sign the Mac out.

## Calls & WhatsApp

Both sources are **off until you switch them on** in the app. Then turn on **PRM** under System Settings → Privacy & Security → Full Disk Access (the app links there). The app is not sandboxed for this reason, so it's distributed outside the App Store.
