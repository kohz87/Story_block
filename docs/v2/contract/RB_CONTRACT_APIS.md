# RB phase 0 draft v4: API appendix

Read with [the contract](RB_CONTRACT.md). These are **existing APIs at the four reference commits
in §2**, not invented families. A transfer keeps the shipped name once; a new adapter/argument
is identified below. Paths are relative to the named repository; links point to the inspected
files. Optional arguments retain current defaults unless the contract explicitly replaces them.
This ledger copies checked-out signatures; new contracts are marked separately.
Names absent at these heads stay absent. All changes proposed by the contract are listed in
the migration table below; retained query wire shapes are not replaced by new state types.
Commands return the SB receipt envelope; each command’s data below is receipt.data, and nested
ctx.call returns {summary,narrate,data}, sharing its root transaction. Query feature-off
returns null through the registry, not a fabricated empty sheet. Unknown public query throws;
unknown ctx.query throws NOT_FOUND. General bad op/domain validation yields INVALID/FAILED.

### SB registration, dispatch and replay

| Existing surface | Evidence and constraint |
|---|---|
| Module fields | [registry.js:43](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/registry.js#L43): id, name, version, description, requires, domains, commands, queries, capture, context, hooks, settings, tabs, screens, widgets, features, cards. No invented module-level registration key. |
| `sdk.registerModule`, `sdk.command`, `sdk.query`, `sdk.view` | [sdk.js:300](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/sdk.js#L300), [sdk.js:313](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/sdk.js#L313), [sdk.js:323](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/sdk.js#L323), [sdk.js:217](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/sdk.js#L217). Public commands are UI actions; views contain frozen state and query access. |
| `ctx.query`, `ctx.call`, `ctx.draft`, `ctx.claim`, `ctx.absolute`, `ctx.time` | [commands.js:295](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L295), [commands.js:236](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L236), [commands.js:227](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L227), [commands.js:287](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L287), [commands.js:270](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L270), [commands.js:334](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L334). query(name,args) returns frozen answer or NOT_FOUND; call(type,payload,options?) returns nested result or throws UNKNOWN_COMMAND/REFUSED/FAILED(depth>=8; MAX_DEPTH=8 at commands.js:36). draft(domain) returns mutable owner slice or NOT_OWNER. claim(key) returns boolean (INVALID empty). absolute(domain,path) returns void, NOT_OWNER/INVALID bad path; time() returns integer minutes or null. No foreign absolute permission. |
| Stored operations and UI attachment | [store.js:3](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/store.js#L3): replay does not call handlers; UI ops follow their carrier. Guard-aware replay and absolute multi-owner restoration are new contract work. |
| Receipts / failures / replan | [commands.js:351](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L351), [commands.js:467](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/commands.js#L467): receipt `{id,type,module,cause,seed,summary,narrate,data,rev,replan?:{payload,line?},afterCapture?:true}`; successful bus transaction `{ok:true,ops,receipt,state,problem?}`, public action `{ok:true,receipt}`; failure `{ok:false,code,message}`. afterCapture is a sibling flag (turn.js:720), not nested in replan. |
| Cards | [reply-cards.js:1](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/reply-cards.js#L1): cards[id].for(state,message,ctx); tone/icon/title/text, up to four rows/three actions, command+payload or open. Later is viewer state, not save state. |
| Tab/screen `active(state,ctx)` | [view/screens.js:102](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/view/screens.js#L102): `{on,badge?}`; retain active Fight behavior. |

Additional exact current signatures behind the v4 host/lifecycle work:

| Existing signature | Current behavior / source |
|---|---|
| `sdk.modules()` | `[{id,name,version,domains,commands,kinds,tabs,features}]` in module-ID order (SB registry.js:362); advertises every registered command, no lifecycle status. SB src/v2/sdk.js:372. |
| `newRecordId()` | `sw_${randomId().replace(/-/g,'').slice(0,12)}`; randomId emits UUID hex. SB src/v2/persist.js:53; src/id.js:2. Source mapping is new; domain regex remains eight-base36. |
| `fightRunner(view=null)` | Reads live sdk.modules and accepts any other module declaring combat.*; otherwise probes combat.foesBeaten/session/offers through view.query. SD src/v2/module.js:194. |
| `precheck(ctx,payload={})` | assist.precheck reads `{key,line}`, claims message, calls capture.check; if result lacks outcome and names pending check, calls legacy check.roll `{id:pending}`, swallowing UNKNOWN_COMMAND. SB src/v2/assist/classifier.js:134 (definition), :140/:147/:152. |
| `itemDef(item)` | Copies id/name/kind/rarity/value/stack/slot/stats/effect/tags/note, optional carry; no hands/requires/weight. SB src/v2/packs/content.js:20. |

### RB combat and bestiary

Registered at [combat/index.js:952](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L952).
All names remain RB-owned. v2 sheet/skills/temporary-unit adapters are new; engine stays.

| Command | Existing payload and behavior | Definition |
|---|---|---|
| `combat.start` | `{offer}` → create fight/session and seeded setup | [index.js:468](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L468) |
| `combat.act` | `{action:{type,target?,skill?,item?,actor?},session?,board?,logLength?}` → player action, then automatic turns until next choice; action types attack/skill/item/defend/flee/parley/auto | [index.js:549](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L549), [cleanAction:143](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L143) |
| `combat.flee` | `{session?,board?,logLength?}`; same stale-view checks | [index.js:560](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L560) |
| `combat.end` | `{session?}`; settle ended fight exactly once, pools/uses/XP/loot | [index.js:580](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L580) |
| `combat.dismiss` | `{offer}`; decline offer | [index.js:773](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L773) |
| `combat.fold` | `{rev?}`; system only | [index.js:742](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L742) |

| Query | Existing projection | Definition |
|---|---|---|
| `combat.offers({})` | Offer array with text/card | [index.js:962](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L962) |
| `combat.session({})` | Null or id/status/stakes/round/place/combatants/order/turn/actions/log/logLength/board | [index.js:968](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L968), [view.js:140](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/view.js#L140) |
| `combat.last({})` | Last result plus folded/fresh | [index.js:734](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L734) |
| `combat.foesBeaten({sinceRev?})` | `[{rev,foes:[{name,count}],won}]` | [index.js:933](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L933) |
| `bestiary.creatures({})` | `[{name,level,template,look}]` | [index.js:974](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L974) |

Retained pure engine helpers (RB src/; validated inputs, no bus envelopes):

| Exact helper signature | Result / refusal | Source |
|---|---|---|
| maxHp(stats,level,rules=DEFAULT_RULES,bonus=0); maxMp(...); maxSp(...) | nonnegative rounded maxima (HP≥1), numeric fallbacks; no coded refusal | rules.js:316, :321, :327 |
| derive(stats,gear={},rules=DEFAULT_RULES) | `{patk,matk,pdef,mdef,crit}` | rules.js:341 |
| statForCheck(skill,stat=null); outcomeOf(die,mod,dc) | Stat (unknown→LUK) / crit,critfail,success,cost,fail; no coded refusals | v2/party/checks.js:35, :57 |
| checkModifier(stat,rules=DEFAULT_RULES) | bounded integer modifier | rules.js:361 |
| hitChance(attackerDex,targetAgi,rules=DEFAULT_RULES); mitigate(raw,defence) | numeric hit% / prevariance damage | rules.js:378, :384 |
| startFight({rules=DEFAULT_RULES,...setup}={}) | Fight with id/seed/stakes/round/status/turns/speedOffset/time/order/turn/turnStarted/combatants/log/actions/rngState/setup/stats/marks plus optional stunRule/hitRule/spellRule; normalizes/advances opening | combat.js:874 |
| availableActions(fight,rules=DEFAULT_RULES) | `{actor,targets:{enemies,allies},skills:[{name,usable,reason,target}],items:[{name,qty,target}],canParley,parleyChance,canFlee,fleeChance,previews}`; empty collections/actor null when no turn | combat.js:914 |
| act(fight,action,rules=DEFAULT_RULES) | new Fight; throws over/invalid/unavailable action | combat.js:946 |
| replay({setup,actions=[]},rules=DEFAULT_RULES,{before=null}={}) | rebuilt Fight; before(fight,action) callback before each; invalid action throws | combat.js:1013 |
| foeXpWorth(enemy,memberLevel,rules=DEFAULT_RULES,{parleyed=false}={}) | nonnegative integer XP, at least1 if raw>0; **member level required** | combat.js:1044 |
| summarize(fight,rules=DEFAULT_RULES) | `{outcome,rounds,seconds,stakes,party:[{memberId,name,level,hp,mp,sp?,down,conditions:[{name,rounds}]}],enemies:[{id,name,questName?,gone,xp,level,rank}],defeated,fled,parleyed,xp,loot:{items,money},keyMoments,uses,itemsUsed}` | combat.js:1056–1125 |

Rules-v2 combat action/target/condition records and interpreter adapters are [B3/B4 design
work](RB_TRACK_B_DESIGN.md), including C fixtures and retained-maths regression tests. The table
above remains the exact shipped API, not a claim that one target expresses mixed effects.

### RB items, equipment and wear

Registration: [items/index.js:57](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/index.js#L57).

| Command | Existing payload / restrictions | Definition |
|---|---|---|
| `item.use` | `{stack,target?,piece?}`; piece selects repair gear; default target PC. Trusted `story:true` also `{stack?\|name?,on?\|target?,qty?}`; UI story:true does not raise authority. data `{actor,stack,def,name,hp,mp,cured,now:{hp,mp}}`; REFUSED full/no benefit, harmful-only, wrong kind or UI during fight; NOT_ENOUGH no doses, NOT_FOUND actor/stack. Repair/story variants return their recorded changes/refusal summary, not this dose projection | [commands.js:90](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/commands.js#L90) |
| `item.equip` | `{stack,to?,actor?}`; to equips on another member, actor validates current wearer. New targetSlot is contract extension. | [commands.js:285](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/commands.js#L285) |
| `item.unequip` | `{stack}`; item stays owned | [commands.js:362](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/commands.js#L362) |
| `item.give` | `{stack,to,qty?}`; default qty1 | [commands.js:377](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/commands.js#L377) |
| `item.wear` | `{name\|stack,wear:'scuff'\|'tear'\|'ruin',why?,story:true}`; validated story word, no arbitrary damage number | [wear.js:8](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/wear.js#L8) |
| `item.fightWear` | `{fight,members:[{actor,taken,maxHp}]}`; combat-end internal settlement | [items/index.js:64](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/index.js#L64), [wear.js:129](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/wear.js#L129) |

| Query | Existing projection | Definition |
|---|---|---|
| `items.usable({actor?})` | Usable held consumables with target help information | [items/index.js:68](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/index.js#L68) |
| `items.useOn({})` | Stack → eligible `{id,name}` target array; empty during fight | [queries.js:47](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/queries.js#L47) |
| `items.gear({actor?,settings?})` | `{actor,level,counted,unused,bonuses}`; derived from SB stacks, includes wear/refine | [queries.js:61](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/queries.js#L61) |
| `items.carry({owner?,add?:[{def?:object\|string,defId?:string,qty?:number}],move?:boolean,settings?})` | Overview on/size/people/bag/load/capacity/bonuses/bonus, or addition plan ok/on/weight/owner/load/capacity/partyLoad/partyCapacity/message | [queries.js:155](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/queries.js#L155) |
| `items.condition({stack})` | Null or stack/band/cur/max/refine/name/factor | [queries.js:129](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/queries.js#L129) |
| `items.slots({settings?})` | **Today only `{accessory,worn}`**, not an eight-slot descriptor. Contract adds a v2 slot projection without removing these compatibility counts. | [queries.js:187](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/queries.js#L187) |
| `items.canWear({actor,stack?\|defId?\|def?,settings?})` | `{ok,why?}`; new slot/requirements rules extend this same query | [queries.js:197](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/queries.js#L197) |

Existing six-slot rules: weapon/offhand/armour/worn/two accessories; 2H tag. Sources:
[rules.js:38](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/rules.js#L38),
[items/commands.js:319](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/commands.js#L319).
New eight-slot IDs and target argument are explicitly §5 P07, not a claim about current code.
Carry weights/capacity: [carry.js:7](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/carry.js#L7).
Wear/refinement lives in RB gear, not SB equipped records: [wear.js:19](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/items/wear.js#L19).

### RB trade and crafting

| Command | Existing payload | Definition |
|---|---|---|
| `trade.buy` | `{shop,def,qty?,who?} (qty default1)` → data `{kind:'buy',def,name,qty,each,total,who,shop}`; INVALID bad qty/stock, NOT_FOUND item, NOT_ENOUGH funds/stock, REFUSED closed/heavy | [trade/index.js:124](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L124) |
| `trade.sell` | `{stack,qty?,kind?,who?} (qty default1)` → `{kind:'sell',def,name,qty,each,total,who}`; INVALID qty, NOT_FOUND stack, NOT_ENOUGH held qty, REFUSED closed/worn/unsellable | [trade/index.js:111](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L111) |
| `trade.repair` | `{stack,at?}` → `{kind:'repair',stack,def,name,fee,from,to,was,band,who}`; FEATURE_OFF, REFUSED market/worker/nongear/full, NOT_ENOUGH funds | [trade/index.js:109](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L109), [repair.js:104](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/repair.js#L104) |
| `trade.refine` | `{stack,at?,materials?:[{stack?\|name?,qty}]}` → `{kind:'refine',stack,def,name,level,took,chance,fee,materials,who}`; FEATURE_OFF, REFUSED closed/wrong worker/max/tattered, NOT_ENOUGH materials/funds, CLAIMED repeated | [trade/index.js:110](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L110), [repair.js:185](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/repair.js#L185) |
| `craft.commission` | `{piece,materials:[{stack,qty}],crafter}` → `{kind:'commission',order,name,fee,ready,span,who}`; INVALID plan, NOT_FOUND material, NOT_ENOUGH supplies/funds, REFUSED closed/wrong crafter | [trade/index.js:152](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L152) |
| `craft.collect` | `{order}` → `{kind:'collect',order,name,who}`; CLAIMED repeated, NOT_FOUND order, REFUSED not ready/closed/heavy | [trade/index.js:176](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L176) |
| `craft.learn` | `{name,who?,from?,makes?,with?,craft?,rank?,slot?}` → `{actor,recipe,name,from,story,craft,dc}`; UI REFUSED, NOT_FOUND actor, INVALID name/craft, REFUSED known/teacher/cap/value/material plan | [craft/commands.js:116](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/commands.js#L116) |
| `craft.forget` | `{name,who?}` → `{actor,recipe,name}`; UI REFUSED, NOT_FOUND actor, INVALID name, REFUSED unknown recipe | [craft/commands.js:187](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/commands.js#L187) |
| `craft.make` | `{name,by?\|who?,with?,at?,roll?,result?}` → `{craft,actor,recipe,kind,roll,die,modifiers,mod,dc,total,quality,said,mismatch,note,item,qty,lost,refine,minutes,clock,owner,carrier}`; UI REFUSED, INVALID no name, NOT_FOUND actor/recipe, REFUSED unknown skill/station/materials/reply cap | [craft/commands.js:284](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/commands.js#L284) |

learn/forget/make are story/internal calls, not new UI freebies: guarded registration
[craft/commands.js:437](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/commands.js#L437).

| Query | Existing projection | Definition |
|---|---|---|
| `trade.market({settings?})` | `{open,by,place,tier,buy,sell,level,day,shortage,type,tags,from,factors,why,scale}` (trade/core.js:454) | [trade/index.js:205](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L205) |
| `trade.stock({kind?,settings?})` | `{shop,kind,day,open,shortage,items:[{def,price,note}]}`; pack variant also `{name,keeper,pack:true}`, items add left; default general (core.js:493, :507) | [trade/index.js:207](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L207) |
| `trade.quote({type,...command payload})` | Pure plan or failure; buy/sell/commission/collect/repair/refine | [trade/index.js:209](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L209) |
| `trade.shops({})` | Pack shops here `[{slug,name,kind}]` or null for generic traders | [trade/index.js:218](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L218) |
| `trade.orders({})` | `[{id,piece,materials,fee,ready,crafter,place,due}]` | [trade/index.js:220](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L220) |
| `craft.view({settings?})` | `{people:[{id,name,you,skills:[{craft,rank,uses,toNext,max}],count,recipes:[{id,name,craft,from,station?:{name,here},materials:[{name,need,have}],chances:{fail,normal,fine,masterwork},dc,mod,ready,why?}]}]}` | [craft/queries.js:3](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L3) |
| `craft.known({actor?})`, `craft.recipes({})` | known `[{id,name,craft,dc,source,from,makes}]`; recipes `[{id,name,craft,stats,stations,dc,minutes,known,source,makes,materials:[{name,qty}]}]` | [craft/queries.js:62](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L62), [queries.js:69](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L69) |
| `craft.last({})`, `craft.log({})` | last `{carrier,rev,results:[{id,actor,name,text,quality,qualityText,item,mismatch,note}]}` or null; log retained made entries in rev order | [queries.js:77](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L77), [queries.js:88](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L88) |
| `craft.rollsUsed({carrier})`, `craft.skills({actor?})` | Roll indices; craft/rank/uses/toNext/max | [queries.js:90](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L90), [queries.js:95](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/queries.js#L95) |

Current domain validators: combat/bestiary registration
[combat/index.js:941](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/combat/index.js#L941);
trade [trade/index.js:227](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L227);
craft [craft/domain.js:85](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/domain.js#L85).
Keep their constraints and typed sheet adapters; do not replace their stores with “as today”
plus undocumented new authoritative fields.

Retained UI queries `rpg-battle.cards/heroes/hud/itemDetail/carry/crafting/trade` are registered
at [screens/view.js:735](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/screens/view.js#L735). itemDetail({stack}) returns
stack/kind/slot/slotLabel/stats/effect/wearer/helps/condition/refine/lines or null
[:523](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/screens/view.js#L523). Keep these adapters for existing screens.
`rpg-battle.rev` returns meta.rev, [module.js:264](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/module.js#L264).
Crafted item IDs remain craft/<slug> or craft/<order suffix>, not renamed to story IDs:
[craft/make.js:209](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/craft/make.js#L209),
[trade/index.js:164](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/trade/index.js#L164).

### RB party, checks, creation, effects and return

Shipped actor records: `{id,name,kind:'pc'|'companion',control:'player'|'auto',role,npc:string|null,
portrait?,background?,origin?:{race:{id,name}|null,talents:[{id,name}]},growth?:'auto'|'manual',
level,xp,points,stats,hp:{cur,max,lost?},mp:{cur,max,lost?},sp:{cur,max,lost?},
skills:[{name,level,uses,active}],conditions:[{kind,stacks,rounds?,at?}],earned?,up<N>?:{xp,points,hp,mp,sp}}`.
Queries fit pools/levels and resolve portraits; they never expose a lost-only replacement.
Sources: RB [validate.js:16](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/validate.js#L16),
[queries.js:18](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/queries.js#L18),
[pools.js:60](https://github.com/kohz87/rpg_battle/blob/c24e93d7283a2dcc66e9963f140a1baa786916e3/src/v2/party/pools.js#L60).

| Shipped query | Arguments → result / absence | Source in RB src/v2 |
|---|---|---|
| party.actors | `{}` → ActorRecord[] in display order | party/queries.js:37 |
| party.actor | `{id?,name?}` → fitted ActorRecord or null; id wins | party/queries.js:42 |
| party.pc | `{}` → fitted ActorRecord or null | party/queries.js:50 |
| party.offers | `{}` → waiting offers with text, oldest first | party/queries.js:59 |
| party.pools | `{}` → `{[actor]:{hp:{cur,max},mp:{cur,max},sp:{cur,max},down,lapsed:string[],turns:{[kind]:number}}}`; **not array** | party/queries.js:168 |
| party.terms | `{settings?}` → `{levelName,xpName,tiers:{size,numerals}\|null}` | party/queries.js:69 |
| party.ranks | `{settings?}` → `[{id,title,levels:[lo,hi],reward:[lo,hi]}]` | party/queries.js:86 |
| party.toSpend | `{}` → `{total,people:[{id,name,points}]}` | party/queries.js:96 |
| party.combatNumbers | `{id,settings?}` → `{attack,magic,defence,mdef,crit,hit,dodge,foe,stats,hp,mp,sp,gear,effects?,encumbered?}` or null | party/queries.js:123 |
| party.encumbered | `{actor?}` → `{penalty,stats,text}` or null | party/queries.js:156 |
| party.effects | `{actor?,now?:{minutes,turn}}` → `[{id,actor,name,note,tone,left,source,checks:[{on,amount}],combat}]`; feature-off null through host | party/queries.js:110 |
| checks.log | `{}` → check log entries, up to30, oldest first | checks/queries.js:27 |
| checks.rolls | `{for?:integer}` → `{for,rolls,rev,actors?:Id[]}` or null | checks/queries.js:32 |
| checks.last | `{}` → `{carrier,rev,results:[{id,actor,name,text,outcome,outcomeText,mismatch,note}]}` or null | checks/queries.js:43 |
| checks.modifiers | `{actor?,skill?,stat?,settings?}` → with skill/stat `[{source,amount,reason}]` or null; without `[{actor,name,you,stats,extras:[{source,name,topics,amount}]}]` | checks/queries.js:64 |
| checks.view | `{}` → `{[check]:{id,actor,who,skill,stat,die,roll,modifiers:[{reason,amount}],total,dc,outcome,outcomeText,said,text,summary,flag,note,pass}}` | checks/queries.js:81; checks/card.js:68 |
| checks.toldBack | `{for:integer}` → string[] for prior reply; [] without index/receipts | checks/queries.js:86; checks/card.js:168 |
| return.point | `{}` → `{index,beforeRev,place,fight}` or null while living | return/index.js:117 |
| return.status | `{}` → `{dead,point}` | return/index.js:123 |

There is **no checks.pending**. Transfer shipped checks interfaces once to SD, then replace
mandatory party lookup with §3's standalone policy. Do not invent its supposed single-pending
wire shape. Likewise there is no shipped checks.roll or check.roll command; checks.prepare
exists. New checks.roll is a proposed SD resolver.

| Shipped command | Payload → data | Refusals; source in RB src/v2 |
|---|---|---|
| party.create | `{name,points?:{STAT:n},preset?,skills?:string[],role?,portrait?,replace?,origin?,background?}` → `{actor}` | INVALID name/points/portrait/origin; REFUSED duplicate/skills/caps/existing PC; NOT_FOUND preset/library. party/commands.js:162 |
| party.addCompanion | `{name,role?,level?,preset?,focus?:Stat[],skills?:string[],control?:'auto'\|'player',growth?:'auto'\|'manual',npc?,portrait?}` → `{actor,level}` | Direct UI REFUSED; full/duplicate/skill restrictions REFUSED, bad level/control/growth INVALID. commands.js:236 |
| party.edit | `{actor,name?,role?,control?,growth?,npc?,portrait?}` → `{actor,growth?,spent?}` | INVALID bad toggle/name; REFUSED duplicate/no change/PC auto control or growth edit; NOT_FOUND actor. commands.js:296 |
| party.removeCompanion | `{actor}` → `{actor,handed:{stacks,coin}}` | REFUSED noncompanion/fight; NOT_FOUND actor. commands.js:355 |
| party.spend | `{actor?,points:{STAT:n}}` → `{actor,points:number}` | INVALID empty map/invalid allocation, REFUSED insufficient/cap by spending rule. commands.js:368 |
| party.grantXp | `{quest?,difficulty?,amount?,actor?,actors?:Id[],xp?:number\|Record<Id,number>,kind?:'minor'\|'major'\|'milestone',claim?,reason?}` → `{gains:[{actor,xp,levels}]}` (capped gains[]) | Direct UI REFUSED; INVALID amount/difficulty/kind, NOT_FOUND party/actor, REFUSED zero award, CLAIMED duplicate. commands.js:662–710 |
| party.heal; party.restore | `{actor?\|who?,hp?,mp?,sp?,cure?:string[],item?}` → `{actor,hp,mp,sp,cured}` | Direct UI/dead/fight/no benefit REFUSED; bad nonnegative amounts INVALID, unknown actor NOT_FOUND. commands.js:509 |
| party.fightPools | `{actors:[{id,hp?:number,mp?:number,sp?:number}]}` → `{actors:Id[]}` | Direct UI REFUSED; malformed pools INVALID; missing/dead actor skipped. commands.js:545 |
| party.applyResult | `{outcome,stakes,actors:[{id,hp,mp,sp?,down,conditions:[{kind,rounds}],uses}]}` or `{result,stakes?}` → `{actors,levels,mastery,died:[{id,name}]}` | Direct UI REFUSED; bad result INVALID, nobody named NOT_FOUND. commands.js:609. Existing death/uses semantics explicitly migrate below. |
| party.rest | `{kind:'short'\|'long',actors?:Id[],reason?}` → `{kind,gains}` | INVALID kind; REFUSED active fight/all dead; NOT_FOUND party/actor. commands.js:462 |
| party.recover | `{}` → `{kind:null}` or `{kind,hours,rested,gains}`; replan:true | Direct UI without caller REFUSED; nested module call permitted. party/recovery.js:180 |
| party.acceptOffer | `{offer,focus?,skills?,control?,setAside?}` → accepted command's data | NOT_FOUND no waiting offer; delegated restrictions apply. commands.js:860 |
| party.dismissOffer | `{offer}` → `{offer}` | NOT_FOUND missing offer. commands.js:876 |
| party.learnSkill | `{actor?,name,template?:{type,stat,target,element},setAside?,free?}` → `{actor,skill}` | INVALID no name, NOT_FOUND library/template, REFUSED known/locked/cap. commands.js:390 |
| party.setSkillActive | `{actor?,name,active,swapOut?}` → `{actor,skill,active}` | NOT_FOUND unknown skill, REFUSED unchanged/limit. commands.js:418 |
| party.forgetSkill | `{actor?,name}` → `{actor,skill}` | NOT_FOUND skill. commands.js:432 |
| check.resolve | `{actor?\|who?,skill,stat?,dc,what?}` → recorded d20 check result | NOT_FOUND actor, INVALID skill/DC; moves to SD adapter. commands.js:717 |
| checks.prepare | `{for?:integer\|null}` → `{for,rolls}` (dice generated, not supplied) | All cause ui REFUSED; invalid for index INVALID; checks/commands.js:154 |
| party.addEffect | `{actor?\|who?,name,note?,tone?,strength?:number\|string,on:string\|string[],for?:string\|{minutes}\|{replies},source:{kind,name?,ref?},claim?,preset?:'setback'}` → `{effect,actor,renewed}` | Direct UI REFUSED, invalid preset/duration INVALID, duplicate CLAIMED. party/effects.js:501 |
| party.endEffect | `{effect}` → `{effect}` | Direct UI REFUSED, NOT_FOUND unknown effect. effects.js:527 |
| party.effectsTurn | `{}` → `{turn,gone:Id[]}` | All cause ui REFUSED (including nested). effects.js:541 |
| return.cue | `{fight,place?}` → `{fight,place}` | INVALID fight/place, REFUSED still dead, CLAIMED duplicate. return/index.js:62 |

`who` in the request's grantXp example is **not read by shipped grantXp**: actor/actors select
recipients; absent selectors award party. Unknown who is currently ignored, not a new target
alias. Keep `{quest,difficulty}` (SD quests/index.js:480) and `{actor,amount}` (RB
combat/index.js:619) exactly. Interpreting who as a selector would be an API proposal/migration;
P18 recommends no change. This follows the code where review shorthand differs.

Creation/portable interfaces remain in legacy runtime; rules-v2 adds class selection and
validates exports/imports against immutable rules, never converts an old character silently.
`party.export({}) -> data:{actor,character,fileName}` (commands.js:749),
`party.import({character,name?,portrait?,background?}) -> {actor,items,purse,cut}` (commands.js:804),
no PC NOT_FOUND / existing PC REFUSED; import direct UI REFUSED and file validation propagates.
`creation.import` has same input, data `{actor,level,items:number,equipped:string[],purse,cut?}`
(creation/commands.js:341); refuses existing PC/bad file/name/portrait, nested failure atomic.
`creation.finish({name?,background?,portrait?,race?,talents?,points?,preset?})` returns
`{actor,race,talents,stats,preset,skills}` (creation/commands.js:195); existing PC REFUSED, bad
build INVALID/REFUSED/NOT_FOUND. `creation.rollTalent({talents?,points?}) -> {talent,name,cost}`
(:259), existing PC/budget/cap REFUSED, no talents NOT_FOUND; `creation.skipStart({}) -> {}`
(:291), existing PC REFUSED. Query `creation.content({settings?})` and
`creation.build({race?,talents?,points?,settings?}|{draft,settings?})` return the content catalog and
`{ok,code,message,budget,cost,spent,left,race,talents,bonus,stats,rows,axes,origin,maxTalents,talentsLeft,rolled,points,raceName,talentNames,problems,issues}` (creation/build.js:102–184) respectively
(creation/commands.js:133, :157); missing selections are issues, no writes.

Exported `returnInTime(sdk)` (return/index.js:76) requires sdk query/command/rewind; returns
`{ok:true,point,receipt}` or `{ok:false,code,message,point?,rewound?}`. Missing support
UNSUPPORTED, missing point NOT_FOUND, lookup/rewind exception FAILED, bus failures propagated.
Actual SDK method is rewind({index,beforeRev}), **not rewindTo**. No shipped return.save/load/
checkpoint/clear/back. Contract §8 replaces rules-v2 route through authenticated host snapshots.

### SD clock, threads, quest adapters and journal

| Shipped query | Exact arguments → wire result / absence | Source in SD src/v2 |
|---|---|---|
| director.time | `{}` → `{minutes:integer\|null,text:string}`; unset `{minutes:null,text:''}` | tracker/domain.js:266 |
| director.threads | `{kind=null,status=null,offer=null}` → ordered thread records, omitting private track only | tracker/domain.js:249, :294 |
| director.thread | `{id=null,key=null}` → same record or null; id wins | tracker/domain.js:298 |
| director.retriable | `{}` → thread IDs refused only for place in current tools.reply | tracker/domain.js:288 |
| atlas.place | `{id=null,name=null}` → `{id,name,region,kind,layer,x,y,discovered,source,aliases,here,trip,routes}` or null | atlas/queries.js:52, :90 |
| atlas.here | `{}` → `{id,name,kind,placeKind,region}` or null; **no danger tier** | atlas/queries.js:98 |
| chronicle.days | `{from=null,to=null}` → Digest[] or null invalid days/off | chronicle/queries.js:145, :263 |
| chronicle.day | `{day=null}` → Digest or null invalid/missing/off | chronicle/queries.js:265 |
| chronicle.dayFacts | `{before=null}` → `{days:[{day,facts,revs}],settle:{from,to}\|null,today:number\|null}` or feature-off null | chronicle/queries.js:191, :271 |
| chronicle.noteFacts | `{after=null,minutes=null}` → `{entries:[{day,entry}],minutes,rev,settle,quests}` | chronicle/queries.js:209 |
| chronicle.questLog | `{id=null}` → `[{rev,text}]`, oldest first | chronicle/queries.js:274 |
| quest.progress | `{id?\|key?,closing?,asStory?}` → `{have,need,met,ready,countable,source,noun,label,reason,finish:{ok,reason},refusal?,place?}` or null | quests/index.js:527–557 |
| quest.details | `{id?\|key?}` → `{id,key,goal,hasGoal,countable,note,giver,due,rank,terms:{target,reward,held,text,level},ready,waiting,owed,taken,ended,status,history}` or null | quests/index.js:764–806 |
| quest.autoTurnIns | `{}` → thread ID[] for current reply | quests/index.js:639 |
| quest.repeatedCoin | `{}` → `{amount}` | quests/index.js:567 |
| quest.owedCredits | `{}` → thread ID[] (at most1) | quests/index.js:945 |
| quest.owed | `{}` → owed views `{id,key,giver,text,word,phrase,countable,total,credit,paid,left,open,storyMoney,budget,payable,rev,ask,hint}` | quests/index.js:809, :858 |
| quest.ranks | `{}` → rank ladder `[{id,title,levels?,reward}]` | quests/index.js:1056; quests/ranks.js:101 |
| quest.followsLadder | `{}` → boolean | quests/index.js:1058 |
| quest.board | `{}` → `{active:[{id,key,goal,note,step,giver,reward,due,taken,ready,progress,meter,status,finish,details}],finished:[{id,key,outcome,outcomeText,reason,details}],finishedCount,hasActive,hasFinished}` | screens/queries.js:266–311 |

Thread wire record is `{id,kind,key,summary,fields,status:'active'|'resolved',offer,taken:{rev,at?}|null,
ended:{rev,at?,reason,outcome}|null,target:{noun,count,kind}|null,
reward:{amount:number|null,each,unit,text}|null,rev,ready?:{rev}|null,shown?:{turn},owed?:{text,rev,
units?,credit?,total?,paid?:Record<string,number>}}`; `track` is removed by queries. Validator
tracker/domain.js:165 and tracker/convert.js:18 allow done/failed/abandoned/declined/superseded,
not expired. New rpg extension stores exact expired while generic ended uses failed.
Digest (chronicle/days.js:753) is `{day,date,line,brief,count,made,happened,more,places,
quests:{taken,done,failed,dropped},fights:{count,won,lost,fled},money:{in,out},npcs,world,met,revs,
moneyText,fightText}`. DayFacts is derived from current receipts; it is not saved visible recap
history. New journal.day must supply visibility/faded filtering and UI-off fallback itself.

| Shipped command | Exact payload → receipt.data | Refusals / source in SD src/v2 |
|---|---|---|
| director.advance | `{minutes,cause?,reason?}` → `{minutes,from,advanced,cause,reason,asked?}`; duplicate reply/cause adds held:'once', advanced0 | Any cause ui REFUSED, even nested; unset clock REFUSED; nonpositive/noninteger/overflow or bad cause INVALID. Clamp advance to1440. time/advance.js:55–86 |
| quest.take | `{id?\|key?}` → `{quest,key,target,reward}` | NOT_FOUND unknown/nonquest, REFUSED terminal/already taken. quests/index.js:344 |
| quest.abandon | `{id?\|key?,reason?}` → `{quest,key}` | NOT_FOUND unknown, REFUSED terminal/not taken. quests/index.js:372 |
| quest.finish | `{id?\|key?,by?:'story'}` → `{quest,key,have,need,source,units,paid,consumed,xp,fights,owed?,by?}` | REFUSED terminal/not taken/story-goal/place/budget, NOT_ENOUGH unmet target, CLAIMED paid; ui cannot assert by-story. quests/index.js:390–514 |
| quest.payOwed | `{id,credit?:true}` → `{quest,key,credit}` or `{quest,key,paid,left,total,credit}` | System only REFUSED otherwise, unknown NOT_FOUND, bad/uncountable/no room REFUSED. quests/index.js:885–929 |
| quest.settle | `{id?,repeated?:boolean}` → recorded settlement data | System only, handles pending turn-ins/repeated-coin; tracker/quest-lines.js:127, :278–332 |

Unchanged SD atlas writers (src/v2/atlas/capture.js), not substitutes for the new policy APIs:

| Existing signature | Payload → data; current boundary |
|---|---|
| `visit(ctx,payload={})`, command atlas.visit (:291) | `{name,kind?,region?}` → `{place,created}`; visits/materializes pl_; region is display text. INVALID missing/unusable name. |
| `edit(ctx,payload={})`, command atlas.edit (:310) | `{place,name?,x?,y?,layer?,region?,kind?}` → `{place}`; NOT_FOUND unknown, INVALID unknown/empty/bad fields, REFUSED name collision. May materialize a pack node. |
| `focus(ctx,payload={})`, command atlas.focus (:377) | `{node}` (null clears) → `{node}`; unknown node returns current focus, no mutation. |
| `packWorld(query)` (world.js:33), `worldOf(atlas,pack={places:[],routes:[]})` (:87) | Pack projection discards normalized content id; world uses `pack:<key>` until materialization. Canonical identity is new work, not an existing atlas.here field. |

The quest part declares domains:{} and uses director.threads (quests/index.js:1041), not a
quests domain. Extraction moves **mechanics/registrations**, retaining that store via new SD
thread writers. Retire SD payOwedHook (:1064), quest tracker payout/settlement hooks
(tracker/quest-lines.js:340) and its RPG capture branch (tracker/capture.js:269) together.
Keep neutral thread capture; add the SD writer/acceptance APIs in contract §3/P23. Existing
acceptance is the SD quest.take implementation above, not a generic writer already available.
SB assist migration is E work in the new-contract ledger below.

### SB inventory, wallet and save points

| Existing command | Payload | Source in SB src/v2/domains/inventory.js |
|---|---|---|
| `inventory.grant` | `{def\|defId\|name,qty?,owner?,note?}`; trusted story/system/module only | [:935](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L935) |
| `inventory.consume` | `{stack\|def,qty?,owner?}` | [:962](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L962) |
| `inventory.transfer` | `{stack,to,qty?}` | [:986](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L986) |
| `inventory.drop` | `{stack,qty?}`; default whole stack | [:1024](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1024) |
| `inventory.equip`, `inventory.unequip` | `{stack,slot?}`, `{stack}`; storage commands, RB supplies legality | [:1039](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1039), [:1059](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1059) |
| `inventory.split`, `inventory.merge` | `{stack,qty}`, `{stack,into}` | [:1073](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1073), [:1092](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1092) |
| `wallet.pay`, `wallet.receive` | `{owner,amount,note?}`; receive also story?:boolean; integer base units, no standalone UI | [:1115](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1115), [:1134](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1134) |
| `inventory.equipOn` | `{stack,actor}` | [:1145](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1145) |
| `inventory.wear`, `inventory.repair` | `{stack,amount}`, module rules only | [:1147](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1147) |
| `inventory.lootTake` | `{sid,pick:[indices]}`, feature guarded | [:1150](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1150) |

| Existing query | Current projection | Source in same file |
|---|---|---|
| `inventory.economy({})` | `{scale,source:'settings'\|'pack'\|'default'}` | [:1770](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1770) |
| `inventory.currency({})` | name/plural/short, optional coins/display | [:1776](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1776) |
| `inventory.items({owner?})` | Default owner=null means **all** owners. `[{stack,def,name,kind,rarity,value,slot,qty,owner,equipped,note,from,cond?,key?,story?,carry?}]`; no id/tag/slot filter (listItems:1635) | [:1779](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1779) |
| `inventory.storyBudget({})` | `{budget,paid,left,vouched}` for current carrier | [:1787](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1787) |
| `inventory.wallet({owner?})` | `{coin?:integer}`; default party | [:1794](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1794) |
| `inventory.find({name})` | status found/ambiguous/none, defs, stacks | [:1796](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1796) |
| `inventory.equipment` | members/worn/wearers/givers/users/limits/detail | [:1805](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1805), [view:1683](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1683) |
| `inventory.loot` | Untaken offers sid/where/n/items | [:1807](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1807) |
| `inventory.condition({stack})` | stack/cond/events or null | [:1816](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1816) |
| `inventory.encumbrance({})` | `{on,encumbered,party,who:[{id,name,load,capacity}],load,capacity,penalty,stats}`; args ignored, feature-off null | [:1821](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/inventory.js#L1821) |

Wallet storage and existing denomination conversion:
[money.js:1](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/money.js#L1),
[money.js:62](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/money.js#L62),
[money.js:88](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/domains/money.js#L88).
`purse.currency` is a **new RB query**, not a renamed SB balance API.

Existing host-local `createSavePoints` exposes `list()`, async `save({name?})`,
`returnTo(id)`, `forget(id)`, `chatId()`:
[rewind.js:178](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/rewind.js#L178).
List points are `{id,name,index,branch,at,rev}`; save creates a branch
[:231](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/rewind.js#L231), returnTo opens it
[:269](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/rewind.js#L269).
None is today's public `savepoint.list/make/restore` bus contract. The new snapshot query
returns eligible Snapshot descriptors; new make/restore have contract §3/§8 payloads.

### SB pack envelope, validation and transport

| Existing boundary | Source / retained rule |
|---|---|
| `validatePack(input,{hostVersion?,capabilities?,limits?})` | [packs/validate.js:40](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L40) → `{ok:true,pack,raw}` or `{ok:false,errors:[{code,path,message}]}`. |
| Closed envelope | [packs/limits.js:33](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/limits.js#L33), [validate.js:69](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L69): id/version/name/author/description/requires/currency/economy/calendar/weather/content/start/layouts/screens/theme. No kind/schema/classes top-level fields. |
| Registered kinds | [limits.js:27](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/limits.js#L27), [validate.js:90](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L90): closed list; new rules kind must be registered before use. |
| requires | [validate.js:158](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L158): storyBlock range and capabilities only. |
| IDs | [validate.js:185](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L185): unique slug in kind; normalized pack.<id>/<slug>. Contract adds cross-kind/expanded-ID checks for rules. |
| Items/skills | [validate.js:226](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L226), [:718](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L718): strict field lists; new rules use separate registered manifest. |
| Shop/recipe references | [validate.js:277](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L277), [:299](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L299): existing item ref normalization retained. |
| Currency | [validate.js:558](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L558): name/plural/short/coins; coins 1..8, values 1..1000000; no second wallet. |
| Content lookup `packs.content` | [packs/index.js:94](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/index.js#L94), [content.js:40](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/content.js#L40): kind/optional pack filter; unknown kind returns []; must add rules kind, not rely on unknown fallback. |
| Inventory projection `itemDef` | [content.js:12](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/content.js#L12): copies known fields/carry; does not preserve hands/requires/weight. New definition-ID lookup closes that seam. |
| Size/safety | [limits.js:5](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/limits.js#L5), [validate.js:53](https://github.com/kohz87/Story_block/blob/47b280668474b9ef056a58453b304435f0624660/src/v2/packs/validate.js#L53): keep envelope bounds/plain safe data plus new rules semantic passes. |

Runtime item rules and content schema 2 are new, while the SB envelope and all existing APIs
above remain the compatibility boundary. The contract marks every required host extension.

### Pack queries, stored domains and NSD seams

At SB src/v2/packs/index.js:93–101, shipped `packs.content({kind,pack=null})` returns normalized
records in pack/file order, unknown kind []; there is **no tag/slug/id filter**. Single item
lookup is `packs.item({name}) -> ItemDef|null` (name/alias/full item definition ID, content.js:106).
There are **no packs.get or packs.entry queries** at these heads. Pack raw id uses `/^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/`, slug
uses length64 (limits.js:136); resolved refs use pack.<raw-id>/<slug>. Record wrapper requires
name and derives/uses slug, then assigns id/slug/pack (validate.js:185–215). Rules-v2 nested
slugs are resolved by the new checker; no change to other kinds' identity policy.

Pinned domains (exact initializer and validator entry points):
SB inventory/scene: domains/index.js:144; SD director: tracker/domain.js:50, tracker/index.js:37;
RB combat/bestiary: combat/index.js:941; gear: items/condition.js:240; creation: creation/commands.js:69;
NSD npc: npc-meters.js:1321. New rules/progress/training/death/savepoints are not at these pins.
`combat = {offers:{},session:null,fights:{},beaten:{},last:[]}`. A fight is
`{id,rev,setup,actions,status,ranks?:[{name,rank}]}`; setup holds party/enemies and optional waves,
seed/place/stakes/turns/speedOffset/hit/field/xpRate/moneyScale/hitRule; packed combatants retain
all engine fields, loot qty ranges stored as range. Actions are cleanAction plus optional
stock:[{member,item,left}]. Beaten is fight-keyed `{fight,rev,foes:[{name,count}],won}`; last is
one `{summary,moments,outcome,rev,parts,reply?}`. validateCombat(slice)->string[] at :845
checks IDs/record keys, offers≤40, fights≤200, beaten≤800, action/stock/status/setup and last.
`bestiary={creatures:{}}`, name-keyed entries retain packed template data/rev; validateBestiary
(:914) checks name/key/level and capacity. Bestiary remains RB-owned.
`gear={events:{}}`; keys `<stack>#<rev>[.<n>]`, values `{stack,wear?,patch?,fray?,repair?,fee?,refine?,lost?}`
(condition.js:199–267). Only known fields, whole bounded values, nonempty changes; refinement
−3..3, wear/patch/fray0..100 (wear≥1), repair boolean; no equipped-slot authority in gear.

NSD shipped queries (src/storysuite-v2.js unless stated):

| Name/arguments | Result / absence | Evidence |
|---|---|---|
| npc.present({meters?:boolean}) | string[] names; with meters:true `[{name,meters:null\|record,stages}]` | :467 |
| npc.known({}) | string[] nonarchived names, dossier order | :476 |
| npc.dossier({name}) | visible dossier registry fields plus relationship/meters/stages/unlocked; null unknown/error; no hidden notes/bookkeeping | :482; src/fields/registry.js |
| npc.portrait({name}) | URL string or null; name/alias/native ID all resolve through name arg | :502 |
| npc.meters({name?}) | `{key,name,meters,stages,unlocked,disposition?,reply?,milestones?,rank?}` or null; no name → array in key order | src/npc-meters.js:1181 |
| npc.socialModifier({name,skill}) | `{mod,name,skill,reasons:[{text,value}]}` or null off/nonsocial/unknown | :524; src/social-check.js:141 |

There is no confirmed-death/native-restore command in shipped COMMAND_NAMES (:75).
The five names npc.adjust/set/refresh/milestone/tick handle meters/stages, not native dossier
life. New identity/checkpoint/applyEvent interfaces in contract §8 are mandatory, including
native history/evidence/applied event IDs. NSD preset runtime is already NSD-owned
(src/npc-meters-presets.js:139; src/storysuite-v2.js:368); extraction is an audit/no-op.

### Proposed API migrations and all affected runtime callers

No alias silently replaces a shipped payload. Additive query fields retain old ones. Changed
semantics below are approved in contract §12 (Approved recommendations, subject to the P11/P13 corrections in V2_LOG.md (USER, 2026-10-24); implementation remains pending); legacy
runtime reads old characters unchanged, fresh rules-v2 uses adapters. All listed caller files
must migrate in the same track or remain explicitly legacy-only; registration/settings go to
lead integration. Tests using these interfaces join that track's regression run.

| Proposed change | Migration and caller inventory (repository paths below src/) |
|---|---|
| Party/sheet/class/three-skill model, no growth:auto or free respec | Keep public party actor pool/skill/origin shapes: skills map name, level=max(1,mastery), uses, active:true; exact0/5 is new rules.sheet.mastery. Keep xp/cur mirrors and npc name; add npcId mapping. RB v2/party/{commands,sheets,pools,queries,capture,tab,portable}.js; v2/creation/{commands,screen,wizard-widgets}.js; v2/screens/{party,view}.js; v2/items/{commands,queries,shared}.js; v2/checks/{commands,modifiers,queries,table}.js; v2/combat/{index,setup}.js; v2/craft/{book,queries}.js; v2/trade/core.js. Retire learn/setActive/forget free-skill v2 routes; keep refused legacy adapters. |
| party.applyResult death and mastery semantics | Preserve input/result keys; remove instant downed-companion death and double skill/XP settlement under new rules; combat.end sole permanent award point. Only runtime caller RB v2/combat/index.js:599; adapter v2/party/commands.js:609; tests cover its result.died consumer. |
| quest mechanics transfer, same thread store | SD v2/quests/{index,progress,ranks}.js; v2/tracker/{capture,quest-lines,index,domain}.js; v2/screens/{queries,quests}.js; v2/chronicle/{days,queries}.js; RB v2/combat/quest.js and v2/screens/view.js; SB v2/{domains/inventory,screens/changes-card}.js. RB nested calls SD offer/accept/link/questWrite/close with write IDs and hashes; SD’s legacy quests/index.js:480 keeps {quest,difficulty}; extracted schema2 handler uses the already-supported {quest,amount,claim} for authored XP; combat/index.js:619 keeps {actor,amount}; P18 recommends no XP payload change. |
| Eight slots + targetSlot, SB legality delegation | Keep item.equip {stack,to?,actor?}; new targetSlot optional. RB v2/items/{commands,queries,page,condition,wear}.js; src/rules.js/items.js adapters, v2/creation/commands.js:381, v2/screens/{party,view}.js, v2/party/tab.js, v2/combat/setup.js. SB v2/domains/inventory.js (equip/equipOn/capture/equipmentView), v2/screens/inventory.js, v2/ui/inventory-tab.js. Use §3 rules.equipPlan with host-private validated transaction plan in every SB equip/capture route; never storage→item.equip recursion or payload bypass. |
| Checks ownership/standalone policy and optional modifiers | RB v2/checks/{index,commands,queries,modifiers,table,card}.js and party check.resolve/capture route → SD new checks; RB v2/module.js and SD v2/module.js registrations. SB v2/assist/{classifier,index}.js capture.check adapter; remove check.roll probe; SB v2/screens/changes-card.js; RB v2/craft/{commands,queries}.js roll allocation; NSD src/storysuite-v2.js checkModifiers hook must not also supply social modifier. Preserve checks.rolls/last query shapes. |
| Retained-chat return and snapshot fields | RB v2/return/{index,card}.js, v2/screens/party.js, v2/board/screen.js; SB v2/rewind.js/savepoints UI/runtime, v2/sdk.js/turn.js/history consumers; SD journal/chronicle consumers and NSD scanning/native stores. Legacy return.cue {fight,place} only in old runtime; new host completion {return} requires token and all-participant completion. |
| Pack rules transport + foe/form/loot adapters | SB v2/packs/{limits,validate,content,index,installed}.js; RB v2/{creation/content,combat/setup,combat/index,items/shared,craft/book,trade/core}.js and src/templates.js legacy path selector; SD atlas canonical place projection; separate Studio import/export. Do not feed ref-based skills/loot through legacy cleaners. |
| Dependency/lifecycle + replay metadata | SB v2/{registry,sdk,commands,store,persist,turn,runtime}.js and module-init dispatch; all module registration entry points; hooks/capture/prompt dispatch honor dormancy; sdk.modules status and SD fightRunner probe migrate together. E's tests gate other tracks. No consumer may infer capability from a floating branch/version alone. |

Public new APIs, authorization, failure envelopes and participant callbacks are specified in
contract §§2–3/6/8; none in this table is called shipped. No migration changes the user decisions.

### V4 new-contract ledger — not shipped APIs

The exact proposed payload/result/authority/error/retry rules live in the linked contract
sections, rather than duplicate definitions here. All writes use host-stamped Source, owner
ledgers, closed validation and atomic root rollback. Query lookups never allocate IDs.

| Offered API / caller | Contract and required implementation migration |
|---|---|
| SD threads.hash / offer / accept / link / questWrite / close; RB quests and neutral SD capture call them | [§3, P23](RB_CONTRACT.md#3-interface-existing-and-new). Extend SD tracker/domain+capture and add writer handlers; new director.writes ledger. Remove RPG direct writes/payouts in SD quests/tracker/quest-lines. RB quest.take invokes atomic accept+rpg; repeat/chain uses fresh offer ID. SB+SD accepts neutral goals without party/rules calls. |
| SD checks.policy / actor / link; creation.finish/import and player controls | [§3, P09/P24](RB_CONTRACT.md#3-interface-existing-and-new). Transfer RB checks once to SD; add ca_↔ac_ one-to-one writer/resolver. Preserve SD bonus/name, explicit checkActor selection/default/new actor at PC creation, unlink/relink UI and missing-RB fallback. Migrate RB creation/commands, party recruitment references and C link controls together. |
| SD atlas.policy / region / placeRegion / placeBind / dangerSet / canonical and world.areaTier | [§3, P24](RB_CONTRACT.md#3-interface-existing-and-new). SD atlas/{domain,world,capture,queries,index}.js: retain pack definition IDs, persist pl_→canonical mapping on every materialization path; explicit rg_ catalog/membership/policy. New APIs do not change atlas.edit payload or existing map/here node IDs. |
| NSD npc.identity({name?:string,id?:RecordId}); SD targetNpc and RB recruitment/death resolve it | [§8, P24](RB_CONTRACT.md#8-death-and-return). Extend NSD native mutation wrapper, hydration/import/scan/manual paths and checkpoint participant. Assign nativeKey↔np_ before exposure; reverse lookup is read-only; restore map+native bytes together. Existing npc.* meter commands do not assign death outcomes. |
| RB rules.registerItem / item / flags / flagSet; SB inventory.registerDefinition / definitions | [§3, P01/P24](RB_CONTRACT.md#3-interface-existing-and-new). E adds SB queries/definition registration/conflict checks and ready-RB capture delegation; A routes generated craft/trade/loot; B freezes rules/provenance and validates template/area/flag proof. No stack grant without matching rule; no changed same-ID definition silently accepted. |
| RB rules.equipPlan; SB inventory.equip/equipOn/item capture | [§3, P07](RB_CONTRACT.md#3-interface-existing-and-new). E checks the returned inputs and keeps the validated plan private; SB alone applies inventory ops. inventory.equipOn gains optional targetSlot; item.equip forwards it. Preserve existing result fields and SB-alone behavior. |
| SB story.evidence / ctx.replayGuard / owner hooks.replayGuard | [§6, P12](RB_CONTRACT.md#6-replay-recording). E retains operation type/payload, recorded inputs/draws, proof parents/hash/Source and block results beyond receipt trimming. B3/B5 supply closed payloads/predicates; deleting parent/guard skips claims and nested effects together. |
| SB savepoint.contract({}) and sdk.timeline.head({}) | [§2](RB_CONTRACT.md#2-dependencies-and-ci-matrix), [§8](RB_CONTRACT.md#8-death-and-return). New capability readiness and exact committed head/prefix accessor; E tests false/malformed/missing contract and native stale-head recovery. No branch-bookmark alias. |
| SB sdk.modules() status/reason + lifecycle dispatch; SD fightRunner(view=null) | [§2, P22](RB_CONTRACT.md#2-dependencies-and-ci-matrix). Retain declared fields, require ready for availability. Dormant/restore-pending commands do not trigger SD encounters; legacy probe only on older hosts, reenable/late registration refreshes before prompting. |
| Host canonical carrier map; all new Source/Cursor/native-prefix consumers | [§4, P12/P22](RB_CONTRACT.md#4-boundary-data-and-identity). Preserve sw_12hex storage keys/old references; durable map to valid canonical sr_8/sw_8, never truncation/index-based identity/regex widening. |
| SB assist.precheck → capture.check → SD checks.roll | [§10 E](RB_CONTRACT.md#e-story-block-host-changes--merges-first). Retain assist.precheck payload and result keys. SD capture adapter creates/verifies active check evidence and calls checks.roll once; resolved outcome ends flow. Remove pending/check.roll probe on the new host; missing handler rolls back claim. No supplied die/outcome, duplicate check, or mandatory RB actor. |
| RB private proof/combat/settlement/death records | [B3–B6 backlog](RB_TRACK_B_DESIGN.md). Move internal design out of phase 0; B supplies schema/checker amendments, C payloads and all merge tests. This row grants no foreign-domain write rights. |

### Capture callback boundary and unchanged grammar ownership

All shipped mechanics captures receive `apply(ctx,line)` with
`line:{op,kind,name,text,labels:Record<string,string>,raw,index}` and return
`{summary,narrate,data,problem?}` or call ctx.fail(code,message). Host alone dispatches as
capture.<kind>/cause story; public UI cannot invoke it (SB registry.js:22–31). The clipped
wrapper preserves data/summary while bounding text; it does not grant arbitrary numeric power.
SB display-only choice/chatter return parsed display values, never mechanics commands
(extras.js:86). Refused lines become Problems, not partial writes. New grammar is contract §3.

| Shipped kinds / owner | Accepted grammar boundary and result/refusal | Code evidence |
|---|---|---|
| item/coin/loot, SB | `+/-/~ item Name` qty/note/used/wear labels; `+ coin N \| from: who`, `- coin N \| to: who`; `? loot Thing, Other x2 — where`. Results are inventory/wallet data above, loot `{sid,where,items}`; INVALID bad line/qty/ambiguity, NOT_ENOUGH absent quantity, grants/budgets clamped with Problems | SB domains/index.js:42; inventory.js:1470, :1603 |
| place/present/weather, SB | `~ place Name \| kind \| region \| with`, `+/- present Name`, `~ weather words`; results respectively place/presence/weather storage receipts, INVALID missing/op/words; weather feature-off | SB domains/scene.js:202–230; domains/index.js:45 |
| wound/join/skill/rest/leave/xp, RB | `~ wound Name \| harm/heal: scratch/wound/severe/grievous`; `+ join Name \| level \| role`; `+ skill Name — Skill Name \| taught by`; `! rest short/long`; `- leave Name`; XP minor/major/milestone words, never numeric award. Join/skill/leave return waiting offer; wound/rest/XP return delegated party result, invalid member/label/limit refused | RB party/capture.js:24, :224 |
| check, RB→SD | `? check <skill/stat> — attempt \| dc \| result \| who \| vs`; result `{check,actor,skill,stat,dc,roll,die,modifiers,mod,total,outcome,said,mismatch,note,carrier}`; NOT_FOUND actor, INVALID stat/DC, REFUSED malformed evidence. Sole transferred owner; new standalone resolver specified in contract | RB checks/commands.js:295–341 |
| effect/use/encounter, RB | `+/- effect Name \| on \| for \| who \| kind`, `! use <item> \| on \| by \| qty`, `! encounter 3 Wolf \| tier \| stakes`; result effect/dose/offer data, REFUSED unsupported/empty/use/actor, INVALID encounter/label; feature guards | RB party/effects.js:560; items/commands.js:271; combat/index.js:114, :796 |
| recipe/craft, RB | `+ recipe Name \| from \| who \| makes \| with \| craft \| slot`; `- recipe Name \| who`; `! craft Recipe \| with \| by \| roll \| result \| at`. Return craft learn/forget/make data; UI refused, unknown actor/recipe/ingredients or invalid roll refused | RB craft/commands.js:410–450 |
| market/repair/refine, RB | `! market <place> \| until`, `~ market <place>` restores supplies; `! repair Piece \| at`; `! refine Piece \| at \| with`. Return shortage/trade result; feature/market/material/cost restrictions apply | RB trade/index.js:357, :365; trade/repair.js:266, :273 |
| time and agenda/event/hook/clock/beat/secret/quest, SD | `~ time <date>` or `! time +duration`; thread `+/-/~ <kind> Name — summary \| fields`. Return minutes/thread/delegated quest receipts; invalid time or unusable thread produces Director Problem. Quest RPG branch transfers to RB, generic fields stay SD | SD tracker/index.js:20–25; tracker/capture.js:1, :269, :424 |
| route/landmark/world/faction, SD | Registered grammar/apply pairs remain their owner's; typed records never gain RPG rewards by registration | SD atlas/index.js:26–28; chronicle/index.js:74–75; atlas/capture.js; chronicle/capture.js |
| npc/milestone, NSD | `~ npc Name \| trust:+N \| affection:-N`; `+ milestone Name — turning point`. Return meter/stage/unlock result; ranges/reply caps clamped, milestone feature-off/empty/refused as NSD rules | NSD npc-meters.js:1321–1326 |

All existing registration and command/capture code stays read-only in this revision. Track E
provides guards/retention/restore/peer gates; A–D implement the proposed adapters after freeze.

NSD command results (src/npc-meters.js:707): MeterResult is
`{name,key,created,changes:[{meter,before,after,held,stop?}],stages:[{meter,from,to}],
ranks?:[{from,to}],milestone?:string,unlocked:Id[],problems}`.
`npc.adjust({name,meters,start?,reply?}) -> MeterResult` (:964), scanner/module-only REFUSED
otherwise; `npc.set({name,meters,reply?}) -> MeterResult` (:979), UI uses head reply regardless
of supplied reply; `npc.refresh({name}) -> MeterResult` (:989), NOT_FOUND no entry/REFUSED
nothing changed; `npc.milestone({name,add?:string[],remove?:string[]}) -> MeterResult` (:1003),
FEATURE_OFF ladders/INVALID empty; `npc.tick({}) -> {day,npcs:[{key,drift:[{meter,before,after}],stages:[{meter,from,to}],ranks:[{from,to}],unlocked,low?}]}` (:1017–1066),
scanner/module-only REFUSED otherwise or if nothing updates. All meter values are code-clamped;
none applies native death or loads a checkpoint.

SB helper `createHost({modules=[],core=true,fakes=false,st={},settings=null,callModel=null}={})`
(testkit/host.js:40) returns Promise of `{st,ctx,registry,settings,features,store,bus,events,sdk,
turn,packs,send,swipe,regenerate,cont,quiet,head,close}`; throws incomplete-runtime without fakes.
The matrix uses real runtime (fakes:false). `sdk.registerModule(def)` returns Promise<sdk>
after validation/ensureModules, throws duplicate/malformed/incompatible definitions;
`sdk.command(type,payload,options={})` allows only cause ui, returns receipt/failure;
`sdk.query(name,args)` returns cloned result or throws unknown; `sdk.view()` returns frozen
`{state,query,settings,feature,chat:{length,lastUser}}` (sdk.js:300, :313, :323, :351).
