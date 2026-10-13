// Site-wide text lives here so personalizing the site means editing one file.
export const site = {
  name: 'Prashanth Sampathkumar',
  tagline: 'Web Developer & AI Engineer',
  description:
    'Personal site of Prashanth Sampathkumar: games rebuilt from memory, tools built for real life, and experiments in between.',
  github: 'https://github.com/PrashSam19',
  linkedin: 'https://linkedin.com/in/prashanthsam',
};

export type SectionKey = 'games' | 'tools' | 'playground';

// The three sections backed by markdown content collections.
export const collectionSections: Record<SectionKey, { title: string; blurb: string }> = {
  games: {
    title: 'Games',
    blurb: 'Classics I grew up on, reverse engineered and rebuilt by hand.',
  },
  tools: {
    title: 'Tools',
    blurb: 'Practical things I had to build to manage real life.',
  },
  playground: {
    title: 'Playground',
    blurb: 'Small experiments that are not quite projects yet.',
  },
};

// Order of the main navigation. Plain pages and collection sections mixed.
export const nav = [
  { href: '/about/', title: 'About', blurb: 'Who I am and what I do.' },
  { href: '/games/', ...collectionSections.games },
  { href: '/tools/', ...collectionSections.tools },
  { href: '/playground/', ...collectionSections.playground },
  { href: '/now/', title: 'Now', blurb: 'What I am working on this month.' },
];
