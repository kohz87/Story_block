import { GENESIS_EPOCH } from '../../../src/v2/timeline/index.js';
export function clockModule({ start = 1410, marked = [], leak = false } = {}) {
    return {
        id: 'story-director', name: 'Clock fixture', version: '2.0.0',
        domains: { director: { initial: () => ({ time: { minutes: start }, expired: 0 }) } },
        replayQueries: leak ? [] : ['director.time'],
        queries: { 'director.time': state => ({ ...state.domains.director.time }) },
        commands: {
            'director.seed'(ctx, { minute }) { ctx.draft('director').time.minutes = minute; ctx.absolute('director', '/time/minutes'); return { summary: 'Set time.' }; },
            'director.advance'(ctx, { minutes, fail = false, omit = false, source = null }) {
                const before = ctx.query('director.time', {}).minutes;
                ctx.replayGuard({ owner: 'story-director', version: 2, epoch: ctx.read('savepoints')?.epoch ?? GENESIS_EPOCH,
                    rulesHash: null, inputHash: ctx.hash({ minutes: before }), predicate: { before } });
                const director = ctx.draft('director');
                const end = before + minutes;
                for (let minute = Math.floor(before / 1440) * 1440 + 1440; minute <= end; minute += 1440) {
                    director.time.minutes = minute;
                    director.expired += 1;
                    if (!omit) marked.push(ctx.clockBoundary({ minute, source: source ?? ctx.source }));
                }
                director.time.minutes = end;
                ctx.absolute('director', '/time/minutes');
                if (fail) ctx.fail('REFUSED', 'Root rolled back.');
                return { summary: 'Advanced.', replan: true };
            },
        },
        capture: { kinds: { time: { grammar: '~ time Minutes' } }, apply(ctx, line) { return ctx.call('director.advance', { minutes: Number(line.name) }); } },
        hooks: { replayGuard({ query, hash }, { guard }) {
            const clock = query('director.time', {});
            return hash({ minutes: clock.minutes }) === guard.inputHash ? { ok: true } : { ok: false, reason: 'The prefix clock changed.' };
        } },
    };
}
export function paidTraining() {
    return { id: 'paid-training', name: 'Training fixture', version: '1.0.0', domains: {
        training: { initial: () => ({ fee: 0, session: null }) },
    }, commands: {
        'training.start'(ctx, { minutes }) {
            const training = ctx.draft('training');
            training.fee = 20;
            training.session = { status: 'running', paid: true };
            ctx.call('director.advance', { minutes });
            training.session.status = 'finished';
            return { summary: 'Paid training completed.', replan: true };
        },
    } };
}
