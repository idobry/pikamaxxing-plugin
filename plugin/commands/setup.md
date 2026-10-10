---
description: Connect Claude Code to your PikaMaxxing trainer account
argument-hint: "[trainer secret]"
---

# PikaMaxxing setup

The user ran /pikamaxxing:setup with these arguments: "$ARGUMENTS"

## If the arguments contain a 32-character hex code (the trainer secret)

Call the `mcp__pikamaxxing__link` tool with that code as `secret`, then tell
the user what it answered:

- "Linked! ..." means done: their pokemon appears in the band above the
  prompt and every Claude turn now earns it tokens. Mention `/pika` for status
  and controls.
- "Linked! Now hatch your first pokemon ..." means the account has no pokemon
  yet: send them to the trainer page link in the answer to open their capsule.
- Anything else: show the message as is.

If the `mcp__pikamaxxing__link` tool does not exist, the PikaMaxxing mod is
not running. Plugin mods are a newer Claude Code feature: ask the user to
update Claude Code (`claude update`), run `/reload-plugins`, and try again. As
a manual alternative they can type `/pika link <secret>` themselves.

## If the arguments contain a short code (about 8 characters)

That is the public trainer id from a share link, not the secret. Ask the user
to copy the full `/pikamaxxing:setup ...` line from the "Connect Claude Code"
card on their trainer page.

## If there are no arguments

Walk the user through starting out:

1. Open https://pikamaxxing.vercel.app and sign in.
2. Open the first capsule on the trainer page to hatch a pokemon.
3. Copy the `/pikamaxxing:setup <secret>` line from the "Connect Claude Code"
   card and paste it here.
