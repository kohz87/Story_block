# Status bar example

A SillyTavern regex script that shows the story's place, purse and health under a reply, using the Story Block `{{sb::…}}` macro. Tutorial: [BUILD-A-CARD.md](../../../docs/v2/BUILD-A-CARD.md).

## Use it

1. Install Story Block (SillyTavern 1.19 or later). Switch the RPG on in **Settings → Features → RPG** if you want the health value.
2. Open **Extensions → Regex**, press **Import**, and choose `status-bar.regex.json`.
3. Make the narrator end a reply with `[STATUS]` (add it to your card's first message or to its narrator instruction).

The marker shows as, for example:

```
📍 Vell Harbour · 💰 6 silver 5 copper · ❤ Hurt
```

## What the script is

| Field | Value | Why |
|---|---|---|
| `findRegex` | `/\[STATUS\]/g` | The marker to replace. |
| `replaceString` | the line with three `{{sb::…}}` macros | Each has a fallback (`|somewhere`, `|0`, `|?`) for when the value is empty or hidden. |
| `placement` | `[2]` | Applies to AI replies. |
| `markdownOnly` | `true` | Only changes what is shown. The model never sees the line, and the saved message keeps `[STATUS]`. |
| `runOnEdit` | `true` | Also redraws after you edit a message. |

The macros read the state after the latest reply on screen, so every message with the marker shows the current values, not the values from when it was written. Change the paths to show other values: see the list in [PUBLIC-API.md](../../../docs/v2/PUBLIC-API.md#paths).
