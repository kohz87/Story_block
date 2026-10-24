// A valid rules pack with one tier 0, one tier 1 and one tier 2 class and `leaves` advanced classes
// below the last one, for size-limit tests. 37 leaves is the largest tree the schema allows:
// 40 classes, 120 skills, 888 written branches, 1452 expanded forms.

export function makeTreePack(leaves = 37) {
    const classes = [];
    const skills = [];
    const branches = [];
    const addClass = (slug, tier, parent) => {
        const names = [0, 1, 2].map(n => `${slug}s${n}`);
        classes.push({ slug, name: `Class ${slug}`, tier, parent, skills: names });
        for (const name of names) {
            skills.push({
                slug: name, name,
                base: { type: 'physical', stat: 'STR', unit: null, cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power: 20 * (tier + 1), element: 'none', damageType: 'physical' }] },
            });
            if (tier !== 3) continue;
            const base = `${name}-base`;
            for (const parent of [base, ...['g', 'a', 'b'].map(c => `${base}-${c}`)]) {
                const step = parent === base ? 1 : 2;
                for (const choice of ['a', 'b']) {
                    const transforms = step === 1
                        ? [{ op: 'set-element', at: 0, value: choice === 'a' ? 'fire' : 'ice' }]
                        : [choice === 'a' ? { op: 'set-target', at: 0, value: 'all' } : { op: 'set-element', at: 0, value: 'lightning' }];
                    branches.push({ slug: `${parent}-${choice}`, name: `${parent}-${choice}`, skill: name, fromForm: parent, step, choice, transforms });
                }
            }
        }
    };
    addClass('r0', 0, null);
    addClass('r1', 1, 'r0');
    addClass('r2', 2, 'r1');
    for (let i = 0; i < leaves; i++) addClass(`l${i}`, 3, 'r2');
    return {
        id: 'tree', version: '2.0.0', name: 'Tree', requires: { storyBlock: '^2', capabilities: ['rb-rules-v2'] },
        content: {
            rules: [{ slug: 'rules', name: 'Tree rules', schema: 2, classes, skills, branches, itemRules: [], trainers: [] }],
            items: [], creatures: [], shops: [], recipes: [], quests: [],
            places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }],
        },
    };
}
