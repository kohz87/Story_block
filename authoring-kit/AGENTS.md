# Authoring kit

Help the author turn their own ideas into a Story Block data module. Work from the author's notes and the references in this folder; do not invent fields or effects the format does not support. Keep existing names and slugs unless asked to change them.

Read `reference/DATA-MODULES-FORMAT.md` and `reference/LIMITS.md` before drafting. Follow the prompts in `prompts/data-module/`. Write the author's JSON and notes only in `work/`, and explain choices in `work/notes.md` rather than adding commentary to JSON.

Run `node check.mjs work/pack.json` and fix every reported problem. If the author actually has another module that provides a capability, pass its name with `--with-capability <name>`. Do not use the network or change the kit itself while drafting. Finish by telling the author what was made and how to import it.
