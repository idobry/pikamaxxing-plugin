---
description: Onboard as a PikaMaxxing trainer and link this Mac
argument-hint: "[trainer secret]"
---

# PikaMaxxing setup

The user ran /pikamaxxing:setup with these arguments: "$ARGUMENTS"

## If the arguments contain a 32-character hex code (the trainer secret)

Link this Mac for the user:

1. Run in the shell:
   `curl -sSL https://pikamaxxing.vercel.app/link/<secret> | bash`
   (substitute the secret from the arguments; the script installs the
   PikaMaxxing app to /Applications and starts it - safe to re-run).
2. Verify it worked: `pgrep -f PikaMaxxing.app` should show a process and
   `~/Library/Application Support/PikaMaxxing/config.json` should exist.
3. Check the trainer actually has a pokemon to display:
   `curl -s -o /dev/null -w '%{http_code}' "https://pikamaxxing.vercel.app/api/me?secret=<secret>"`
   - `200`: they have an active pokemon, all good.
   - `404`: they have signed in but never hatched one, so the app has nothing
     to draw and the screen will look empty. Tell them to open a capsule at
     https://pikamaxxing.vercel.app/u/<secret> - that is the single most
     common reason someone finishes install and sees no pokemon.
4. Tell the user their pokemon is now on screen (notch by default) and that
   hooks feed it tokens starting with their NEXT Claude Code session, so
   they should restart their session soon.

If the argument is a short code (8 characters), that is their PUBLIC trainer
id, not the secret: point them to the "Link your mac" card on their trainer
page (the /u/... address) where the full setup line with the real secret is
shown, ready to copy.

## If no arguments were given

Walk the user through onboarding, in order:

1. Tell them to open https://pikamaxxing.vercel.app and sign in with GitHub -
   that creates their trainer page.
2. Tell them to open a capsule on their trainer page to hatch their first
   pokemon (one free capsule per day; burning tokens earns more).
3. Tell them the "Link your mac" card on their trainer page shows a
   ready-made `/pikamaxxing:setup <secret>` line: they can paste it right
   back here and you will install everything for them (or they can run the
   card's curl command themselves in a terminal - same result).
4. Note that this plugin's hooks are already active, but until linking they
   are harmless no-ops (every command ends in `|| true`, so a missing app
   degrades to nothing rather than breaking any Claude Code tool call).

Confirm with the user once the Mac is linked, then let them know the pet
should start reacting to their next Claude Code session.
