// Registry of playable game components, keyed by the `play` frontmatter field.
import Sudoku from './Sudoku.astro';

export const games = {
  sudoku: Sudoku,
};
