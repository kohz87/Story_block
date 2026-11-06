// The Standard formula's entry: the shared roll engine used by the board and narrated fights. Its parts live in
// standard/: roster.js (sheet to bars), prepare.js (prepareStandard and its helpers) and roll.js (rollStandard:
// turn order, rounds, acts, area and outcomes). This file keeps the same public names and path for every importer.
export { charId, foeId } from './standard/roster.js';
export { prepareStandard } from './standard/prepare.js';
export { outcomeStd, judge, rollStandard, summaryStd } from './standard/roll.js';
