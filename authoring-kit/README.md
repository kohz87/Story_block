# Authoring kit

Use the kit to draft Story Block data modules from your own world. The kit contains prompts, references and the same pack checker the extension uses.

1. Put your notes in `work/lore/` (that folder is not committed).
2. Follow the prompts in `prompts/data-module/` and the format in `reference/DATA-MODULES-FORMAT.md`.
3. Run `node authoring-kit/check.mjs authoring-kit/work/pack.json` from the repository root. Fix the reported problems until it prints OK.
4. Import the pack in Story Block, then enable the data module for your chat.

If the pack needs another installed module, add `--with-capability <name>` when checking. The pack format and size limits are in `reference/PACK-FORMAT.md` and `reference/LIMITS.md`. Code-module guidance is in `prompts/code-module/`.
