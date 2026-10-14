// Registry of playable game components, keyed by the `play` frontmatter field.
import Motherload from './Motherload.astro';
import PrashBoy from './PrashBoy.astro';
import Sudoku from './Sudoku.astro';

export const games = {
  sudoku: Sudoku,
  motherload: Motherload,
  prashboy: PrashBoy,
};
