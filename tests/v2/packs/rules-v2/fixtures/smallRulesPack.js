// Golden smallRulesPack fixture helper from RB_PHASE0 §10 (lines 1231-1255).

export function smallRulesPack(options = {}) {
    const classes = [];
    const skills = [];
    const branches = [];

    for (let tier = 0; tier < 4; tier++) {
        const names = [0, 1, 2].map(n => `s${tier}${n}`);
        classes.push({
            slug: `c${tier}`,
            name: `Class ${tier}`,
            tier,
            parent: tier ? `c${tier - 1}` : null,
            skills: names,
        });

        for (const slug of names) {
            skills.push({
                slug,
                name: slug,
                base: {
                    type: 'physical',
                    stat: 'STR',
                    unit: null,
                    cost: { mp: 0, sp: 1, cooldown: 0 },
                    effects: [{
                        op: 'damage',
                        target: 'one',
                        power: 20 * (tier + 1),
                        element: 'none',
                        damageType: 'physical',
                    }],
                },
            });

            if (tier !== 3) continue; // no starter branching

            const base = `${slug}-base`;
            for (const parent of [base, ...['g', 'a', 'b'].map(c => `${base}-${c}`)]) {
                const step = parent === base ? 1 : 2;
                for (const choice of ['a', 'b']) {
                    const transforms = step === 1
                        ? [{ op: 'set-element', at: 0, value: choice === 'a' ? 'fire' : 'ice' }]
                        : [choice === 'a' ? { op: 'set-target', at: 0, value: 'all' } : { op: 'set-element', at: 0, value: 'lightning' }];
                    branches.push({
                        slug: `${parent}-${choice}`,
                        name: `${parent}-${choice}`,
                        skill: slug,
                        fromForm: parent,
                        step,
                        choice,
                        transforms,
                    });
                }
            }
        }
    }

    const pack = {
        id: options.id ?? 'fixture',
        version: options.version ?? '2.0.0',
        name: options.name ?? 'Fixture',
        requires: options.requires ?? { storyBlock: '^2', capabilities: ['rb-rules-v2'] },
        content: {
            rules: [{
                slug: 'rules',
                name: 'Fixture rules',
                schema: 2,
                classes: options.classes ?? classes,
                skills: options.skills ?? skills,
                branches: options.branches ?? branches,
                itemRules: options.itemRules ?? [],
                trainers: options.trainers ?? [],
                ...(options.statLabels ? { statLabels: options.statLabels } : {}),
            }],
            items: options.items ?? [],
            creatures: options.creatures ?? [],
            shops: options.shops ?? [],
            recipes: options.recipes ?? [],
            quests: options.quests ?? [],
            places: options.places ?? [
                { slug: 'haven', name: 'Haven', x: 0, y: 0 },
                { slug: 'mill', name: 'Mill', x: 1, y: 0 },
            ],
        },
    };

    return pack;
}
