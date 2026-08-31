---
description: Update the PikaMaxxing app on this Mac to the latest build
---

# PikaMaxxing update

Bring this Mac's PikaMaxxing app up to the newest published build.

## Steps

1. Find the installed version and the published one:
   - installed: `defaults read /Applications/PikaMaxxing.app/Contents/Info.plist CFBundleShortVersionString`
     (if that path fails, try `~/Applications/PikaMaxxing.app`; if neither
     exists the app is not installed - send the user to /pikamaxxing:setup)
   - published: `curl -s https://pikamaxxing.vercel.app/api/version`
2. If they already match, tell the user they are up to date and stop. Do not
   reinstall for no reason.
3. Otherwise read this Mac's secret:
   `python3 -c "import json;print(json.load(open(__import__('os').path.expanduser('~/Library/Application Support/PikaMaxxing/config.json')))['secret'])"`
   If that file is missing, this Mac was never linked: send the user to
   /pikamaxxing:setup instead.
4. Reinstall with that secret:
   `curl -sSL https://pikamaxxing.vercel.app/link/<secret> | bash`
   The same command that links a Mac is also the update path: it always
   fetches the current build, replaces the app in place, restarts it, and
   keeps the trainer's secret, pokemon, and collection untouched.
5. Confirm the new version is running:
   `pgrep -f PikaMaxxing.app` and re-read CFBundleShortVersionString.

## Reporting back

Tell the user which version they moved from and to. If the app was already
current, say so in one line. Mention that hooks are unchanged by an update, so
no session restart is needed unless the app was not running before.
