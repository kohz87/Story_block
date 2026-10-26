// Where the kit finds Story Block's own code (the pack checker and its limits). In Story Block this is the
// repository's src/v2/. The copy of the kit in Story Studio points at Studio's vendored Story Block instead:
// that line is the only difference between the two copies of the kit's scripts.
export const SB_V2 = new URL('../../src/v2/', import.meta.url);
