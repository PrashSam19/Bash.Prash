import assert from 'node:assert/strict';
import { generate, countSolutions, conflicts, isComplete, solve, emptyGrid } from './engine.ts';

for (const difficulty of ['easy', 'medium', 'hard'] as const) {
  const t0 = performance.now();
  const { puzzle, solution } = generate(difficulty);
  const ms = Math.round(performance.now() - t0);
  const clues = puzzle.filter((v) => v !== 0).length;
  assert.equal(countSolutions(puzzle, 2), 1, `${difficulty}: puzzle must have exactly one solution`);
  assert.deepEqual(solve(puzzle), solution, `${difficulty}: solver must reproduce the solution`);
  assert.ok(isComplete(solution), `${difficulty}: solution must be complete and conflict-free`);
  assert.equal(conflicts(puzzle).size, 0, `${difficulty}: puzzle must have no conflicts`);
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0) assert.equal(puzzle[i], solution[i]);
  }
  console.log(`${difficulty.padEnd(6)} clues=${clues} generated in ${ms}ms`);
}

const empty = emptyGrid();
assert.ok(countSolutions(empty, 2) >= 2, 'empty grid has many solutions');
console.log('all sudoku engine tests passed');
