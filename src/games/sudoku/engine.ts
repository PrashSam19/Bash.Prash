// Sudoku engine: solve, count solutions, and generate puzzles with a unique
// solution. Grids are flat arrays of 81 numbers, 0 meaning empty.

export type Grid = number[];

const SIZE = 9;
const BOX = 3;

export function emptyGrid(): Grid {
  return new Array(SIZE * SIZE).fill(0);
}

export function rowOf(i: number): number {
  return Math.floor(i / SIZE);
}

export function colOf(i: number): number {
  return i % SIZE;
}

export function boxOf(i: number): number {
  return Math.floor(rowOf(i) / BOX) * BOX + Math.floor(colOf(i) / BOX);
}

/** Indexes of every cell that shares a row, column, or box with `i`, excluding `i`. */
export function peers(i: number): number[] {
  const r = rowOf(i);
  const c = colOf(i);
  const br = Math.floor(r / BOX) * BOX;
  const bc = Math.floor(c / BOX) * BOX;
  const set = new Set<number>();
  for (let k = 0; k < SIZE; k++) {
    set.add(r * SIZE + k);
    set.add(k * SIZE + c);
    set.add((br + Math.floor(k / BOX)) * SIZE + (bc + (k % BOX)));
  }
  set.delete(i);
  return Array.from(set);
}

const PEERS: number[][] = Array.from({ length: SIZE * SIZE }, (_, i) => peers(i));

export function canPlace(grid: Grid, i: number, value: number): boolean {
  for (const p of PEERS[i]) {
    if (grid[p] === value) return false;
  }
  return true;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Index of the empty cell with the fewest legal candidates, or -1 if full. */
function mostConstrainedEmpty(grid: Grid): number {
  let best = -1;
  let bestCount = SIZE + 1;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== 0) continue;
    let count = 0;
    for (let v = 1; v <= SIZE; v++) {
      if (canPlace(grid, i, v)) count++;
    }
    if (count < bestCount) {
      best = i;
      bestCount = count;
      if (count <= 1) break;
    }
  }
  return best;
}

/**
 * Counts solutions up to `limit`. Returns early once the limit is reached,
 * so `countSolutions(g, 2) === 1` is a cheap uniqueness test.
 */
export function countSolutions(grid: Grid, limit = 2): number {
  const work = grid.slice();
  let found = 0;

  function step(): void {
    if (found >= limit) return;
    const i = mostConstrainedEmpty(work);
    if (i === -1) {
      found++;
      return;
    }
    for (let v = 1; v <= SIZE; v++) {
      if (!canPlace(work, i, v)) continue;
      work[i] = v;
      step();
      work[i] = 0;
      if (found >= limit) return;
    }
  }

  step();
  return found;
}

/** Returns a solved copy of the grid, or null if it has no solution. */
export function solve(grid: Grid, rand: () => number = Math.random): Grid | null {
  const work = grid.slice();

  function step(): boolean {
    const i = mostConstrainedEmpty(work);
    if (i === -1) return true;
    const values = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand);
    for (const v of values) {
      if (!canPlace(work, i, v)) continue;
      work[i] = v;
      if (step()) return true;
      work[i] = 0;
    }
    return false;
  }

  return step() ? work : null;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

// Target clue counts. Fewer clues is harder, roughly.
const CLUES: Record<Difficulty, number> = { easy: 40, medium: 32, hard: 26 };

export interface Puzzle {
  puzzle: Grid;
  solution: Grid;
  difficulty: Difficulty;
}

/**
 * Builds a puzzle with exactly one solution. Fills a full grid, then removes
 * cells in random order, restoring any cell whose removal lets a second
 * solution in. Stops when the clue target is reached or no more cells can go.
 */
export function generate(difficulty: Difficulty = 'medium', rand: () => number = Math.random): Puzzle {
  const solution = solve(emptyGrid(), rand);
  if (!solution) throw new Error('Could not fill a grid');

  const puzzle = solution.slice();
  const target = CLUES[difficulty];
  let clues = SIZE * SIZE;

  for (const i of shuffle(Array.from({ length: SIZE * SIZE }, (_, k) => k), rand)) {
    if (clues <= target) break;
    const saved = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle, 2) === 1) {
      clues--;
    } else {
      puzzle[i] = saved;
    }
  }

  return { puzzle, solution, difficulty };
}

/** Indexes of filled cells that conflict with a peer. */
export function conflicts(grid: Grid): Set<number> {
  const bad = new Set<number>();
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === 0) continue;
    for (const p of PEERS[i]) {
      if (grid[p] === v) {
        bad.add(i);
        bad.add(p);
      }
    }
  }
  return bad;
}

export function isComplete(grid: Grid): boolean {
  return grid.every((v) => v !== 0) && conflicts(grid).size === 0;
}
