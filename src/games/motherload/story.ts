// Transmissions: the radio messages that tell the story as you dig. They
// follow the original's beats and depths (and its $1,000, $3,000, and
// $25,000 bonuses), but the words are our own, and the mining company is run
// by one Dr. Prash. Who is definitely just a nice man with a mining company.

export type Speaker = 'prash' | 'devil' | 'unknown' | 'pod3422' | 'pod10043';

export interface Transmission {
  id: string;
  // Plays the first time the pod reaches this depth in feet. Without one, the
  // game triggers it some other way (the welcome message plays at the start).
  depth?: number;
  from: Speaker;
  reward?: number;
  lines: string[];
}

export const SPEAKERS: Record<Speaker, string> = {
  prash: 'Dr. Prash, Prash Mining Co.',
  devil: 'Dr. Prash, Prince of Darkness',
  unknown: 'Unidentified Source',
  pod3422: 'Martian Digging Pod #3422-2',
  pod10043: 'Martian Digging Pod #10043',
};

export const TRANSMISSIONS: Transmission[] = [
  {
    id: 'welcome',
    from: 'prash',
    lines: [
      "Welcome to Mars, recruit! Dr. Prash here, founder, CEO, and Head of Vibes at Prash Mining Co.",
      'Your pod is the finest money could rent. Its fuel tank, however, is running on optimism. Pop into the Propellant Vendor to your left and fill her up.',
      "Then dig. Dig down. Bring me minerals. Sell them at the Mineral Processor, spend it all in my shops, and dig some more. That's the circle of life. Well, of my quarterly earnings.",
      'P.S. All shops are fully automated. No staff, no breaks, no questions. Especially no questions.',
    ],
  },
  {
    id: 'bonus500',
    depth: 500,
    from: 'prash',
    reward: 1000,
    lines: [
      "500 feet already? Look at you go! Here's a $1,000 bonus.",
      "Don't spend it all on fuel. Actually, do. I own the fuel station.",
    ],
  },
  {
    id: 'bonus1000',
    depth: 1000,
    from: 'prash',
    reward: 3000,
    lines: [
      "1,000 feet! You're officially Employee of the Month. You're also officially the only employee who's answered my calls this month.",
      "Here's $3,000. Spend it wisely, and by wisely I mean at the AutoBuy 2000.",
    ],
  },
  {
    id: 'eyes',
    depth: 1750,
    from: 'unknown',
    lines: ['...kkkssshhh... can anyone hear me... the eyes... the EYES... they glow red... kkkhhhh...'],
  },
  {
    id: 'retiring',
    depth: 2100,
    from: 'pod3422',
    lines: [
      "Hey there, rookie! Pod #3422-2 here. Been digging this rock for eleven years.",
      "One more good haul and I'm retiring. Gonna buy a little dome on Europa for me, my wife, and the two kids. Watch your fuel down here, okay?",
    ],
  },
  {
    id: 'help',
    depth: 2500,
    from: 'unknown',
    lines: ["...help... HELP ME... it's coming... I can hear it laughing... kkkkssshhhh..."],
  },
  {
    id: 'lava',
    depth: 3100,
    from: 'pod3422',
    lines: [
      "Rookie, it's 3422-2 again. Heads up: you're getting into lava country. You'll see it glowing in the rock. Don't drill into it unless you like your hull extra crispy.",
      'A better radiator from the AutoBuy will soak up some of the heat. Stay safe out there.',
    ],
  },
  {
    id: 'bonus3500',
    depth: 3500,
    from: 'prash',
    reward: 25000,
    lines: [
      "3,500 feet! Incredible work. Here's $25,000. I'm not crying, you're crying.",
      "A word of caution: pockets of natural gas lurk deeper down. They look exactly like ordinary dirt, and they explode. Get a good hull and radiator.",
      "And whatever you do, don't go below 6,000 feet. There's nothing down there. Nothing at all. Just... boring rocks. Very boring. Turn around at 6,000.",
    ],
  },
  {
    id: 'trapped',
    depth: 4100,
    from: 'pod3422',
    lines: [
      "Rookie? It's 3422-2. Earthquake hit and my drill's busted. I'm trapped and my air's running low.",
      "If you make it out, tell my family I... wait. Something's moving out there. Something with red eyes. Oh no. Oh n-- kkkkhhhhssss...",
    ],
  },
  {
    id: 'motherload',
    depth: 4500,
    from: 'pod10043',
    lines: [
      "THIS IS IT! I've hit the motherload! There's enough Amazonite here to buy a moon! I'm going to be RICH!",
      "Wait. Who are you? Why are you wearing a lab coat down here? Why are your eyes doing that? NO! NOOOOO! kkkkkkhhhhssss...",
    ],
  },
  {
    id: 'turnBack',
    depth: 5813, // where the altimeter starts to scramble
    from: 'prash',
    lines: [
      "You're deeper than 6,000 feet. I specifically told you not to go below 6,000 feet.",
      'TURN. BACK. NOW. Company policy. Liability insurance. Your own safety. Pick whichever one makes you leave.',
      "...Fine. Keep digging. I'll be waiting.",
    ],
  },
  // Hell. These two play every time the fight starts over, so they're never
  // marked as received.
  {
    id: 'reveal',
    from: 'devil',
    lines: [
      "Well, well, well. Someone can't follow simple instructions.",
      "Since you came all this way, a confession: the missing miners? Me. 3422-2's retirement dome on Europa? Never happening. Also me. The red eyes everyone kept screaming about? Believe it or not, also me.",
      "Prash Mining Co. was never about minerals. It was about luring the greedy down to my front door. And here you are, cargo bay and all.",
      "Consider this your final performance review. Spoiler: you're fired. Out of a cannon. Into lava.",
    ],
  },
  {
    id: 'trueForm',
    from: 'devil',
    lines: [
      'OW. That was a very expensive lab coat.',
      "Enough with the human disguise. It itches anyway. Behold my TRUE form: Dr. Prash, PhD in Evil, Chief Executive of Eternal Suffering, master of ALL that is EVIL!",
      "Also, I'm docking your pay.",
    ],
  },
];

export const transmission = (id: string) => TRANSMISSIONS.find((t) => t.id === id);

// What's left of Dr. Prash after the fight, as on the original's victory
// screen. Together they're worth $28,500,000; the split isn't documented, so
// only the total is shown.
export const SPOILS = [
  "Dr. Prash's Kevlar Lab Coat",
  "Dr. Prash's Staff of Hell",
  "Dr. Prash's Laser Monocle",
  "Satan's Hooves",
  "Satan's Horns",
  "Satan's Evil Eye (right)",
  "Satan's Evil Eye (left)",
  "Satan's Boiler of Eternal Infernos",
  'Martian Reward for Restoring Peace',
  '250,000 Shares of Prash Mining Co.',
];

export const VICTORY =
  "Dr. Prash is no more. The miners of Mars are safe, the shops are still fully automated, and nobody has to call you \"recruit\" ever again. Prash Mining Co.'s board voted unanimously to hand you everything he left behind, mostly because he isn't in a position to object.";
