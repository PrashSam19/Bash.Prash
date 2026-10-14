// Registry of playable components (games and interactive tools), keyed by the
// `play` frontmatter field.
import AskPrash from '../tools/AskPrash.astro';
import Motherload from './Motherload.astro';
import PrashBoy from './PrashBoy.astro';
import Sudoku from './Sudoku.astro';

export const games = {
  sudoku: Sudoku,
  motherload: Motherload,
  prashboy: PrashBoy,
  askprash: AskPrash,
};
