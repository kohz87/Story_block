// Literal expected values for the two functions both sides of the rules seam compute (RB_CONTRACT §4 Hash; the
// equip plan's inputHash, docs/v2/INVENTORY-SEAMS.md §3). Each case is the input, the exact normalized text and
// the SHA-256 of that text, written out by hand from an independent implementation (Node's crypto), so a rules
// module can run the same cases against its own code and prove it hashes the same bytes. Copy this file as is.

export const NORMALIZED_JSON_CASES = [
    { what: "keys in UTF-16 code unit order, not code point order", input: () => ({ '\uFF5E': 1, '\u{1F600}': 2, b: 3, a: 4 }), text: "{\"a\":4,\"b\":3,\"😀\":2,\"～\":1}", hash: '6b48dd75584d4c0ba5c8c6e9241d1c529127717044edb16e7b1bd43ba89153d6' },
    { what: "negative zero is 0", input: () => ({ n: -0, m: 0 }), text: "{\"m\":0,\"n\":0}", hash: 'c0705b8b7c5dbbb0343b7cb7e9d4a2b070ea09235aef6fcd2db95285edf17329' },
    { what: "undefined in an array is null, in an object it is left out", input: () => ({ list: [1, undefined, 3], gone: undefined }), text: "{\"list\":[1,null,3]}", hash: 'f6a9ec03368b127d6b7b8ac278628e15ad5b28127f122883e8c5e52bf698196b' },
    { what: "nesting, empty containers, escapes", input: () => ({ z: [], y: {}, x: ['"', '\n', 'é'], w: null, v: true }), text: "{\"v\":true,\"w\":null,\"x\":[\"\\\"\",\"\\n\",\"é\"],\"y\":{},\"z\":[]}", hash: '9bdbe48d8a4493842a9e92b4b5bf96c88444176ad80d090a2d03971774553ee0' },
    { what: "numbers as JSON writes them", input: () => ({ a: 1.5, b: 1e21, c: 100, d: 0.000001 }), text: "{\"a\":1.5,\"b\":1e+21,\"c\":100,\"d\":0.000001}", hash: '5349e4f962dc59f614a8da0823af304baaf2cba34c9e91fadb12bc33b934e398' },
];

// `input` is the argument of equipInputHash; `text` the normalized JSON it hashes (the case's inputs, covered
// parts only: piece = { id, def, qty, owner, equipped }, affected without the piece itself, sorted by id).
export const EQUIP_INPUT_HASH_CASES = [
    { what: "one piece, no slot asked for, one affected piece", input: () => ({ rulesHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', actor: 'ac_ren00001', stats: { STR: 8, VIT: 9 }, life: 'alive', targetSlot: null,
     stack: { id: 'it_helm0001', def: 'story/iron-helm', qty: 1, owner: 'party', equipped: null, note: 'not covered', from: 'rc_1' },
     affected: [{ id: 'it_oldh0001', def: 'story/old-helm', qty: 1, owner: 'ac_mira0001', equipped: 'head', cond: 40 }] }),
      text: "{\"actor\":{\"id\":\"ac_ren00001\",\"life\":\"alive\",\"stats\":{\"STR\":8,\"VIT\":9}},\"affected\":[{\"def\":\"story/old-helm\",\"equipped\":\"head\",\"id\":\"it_oldh0001\",\"owner\":\"ac_mira0001\",\"qty\":1}],\"rulesHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"slot\":null,\"stack\":{\"def\":\"story/iron-helm\",\"equipped\":null,\"id\":\"it_helm0001\",\"owner\":\"party\",\"qty\":1}}",
      hash: 'd063f2dea217eefe9d6468d90bf17069e13eb59332a14bfad7a900c158c2e165' },
    { what: "a slot asked for, two affected pieces given out of order and once more with the piece itself", input: () => ({ rulesHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', actor: 'ac_ren00001', stats: { STR: 8, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 8, CHA: 8 }, life: 'alive', targetSlot: 'weapon',
     stack: { id: 'it_grts0001', def: 'story/greatsword', qty: 1, owner: 'party', equipped: null },
     affected: [{ id: 'it_oldh0001', def: 'story/old-helm', qty: 1, owner: 'ac_mira0001', equipped: 'head' }, { id: 'it_grts0001', def: 'story/greatsword', qty: 1, owner: 'party', equipped: null }, { id: 'it_buck0001', def: 'story/buckler', qty: 1, owner: 'ac_ren00001', equipped: 'offhand' }] }),
      text: "{\"actor\":{\"id\":\"ac_ren00001\",\"life\":\"alive\",\"stats\":{\"AGI\":8,\"CHA\":8,\"DEX\":8,\"INT\":8,\"LUK\":8,\"STR\":8,\"VIT\":8}},\"affected\":[{\"def\":\"story/buckler\",\"equipped\":\"offhand\",\"id\":\"it_buck0001\",\"owner\":\"ac_ren00001\",\"qty\":1},{\"def\":\"story/old-helm\",\"equipped\":\"head\",\"id\":\"it_oldh0001\",\"owner\":\"ac_mira0001\",\"qty\":1}],\"rulesHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"slot\":\"weapon\",\"stack\":{\"def\":\"story/greatsword\",\"equipped\":null,\"id\":\"it_grts0001\",\"owner\":\"party\",\"qty\":1}}",
      hash: 'ba90e1b39d738f0902d7363ee878954e466bc7a39237421b0edec96e0773a139' },
];
