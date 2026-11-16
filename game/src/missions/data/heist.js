// The Coal Vault Job: setup mission, then the job with a loud/stealthy choice and crew selection.
// Crew cuts reduce the take; better crew makes the job easier.
const H = 'Harlan', T = 'Tick', R = 'Rosa', D = 'Dex';
const BASE = 60000;

export const HEIST = [
  {
    id: 'heist_setup', type: 'heist', giver: 'harlan', letter: 'H', title: 'Casing Graves Holdings', blurb: 'Every heist starts with homework.',
    start: { site: 'harlan' }, requires: ['hold'], payout: 2000, medals: { gold: 240, silver: 360 }, suppressWanted: true,
    callLine: 'Come by. Bring a notebook.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[H, 'Graves keeps the forged deeds and his slush money in a vault at his office.'], [H, 'Photograph the entrances. Then steal us a van nobody will miss.']] },
      { type: 'collect', at: { site: 'graves' }, count: 3, spread: 30, interact: true, color: 0x4ad6ff, text: 'Photograph the <em>entrances</em> of Graves Holdings (press E).', checkpoint: true },
      { type: 'spawnVehicle', var: 'getaway', vtype: 'van', at: { random: { min: 300, max: 700 } }, color: 0xe8e8e8, mark: true },
      { type: 'enter', vehicle: 'getaway', text: 'Steal the <em>white van</em>.', checkpoint: true },
      { type: 'deliver', vehicle: 'getaway', to: { site: 'quill' }, minHealth: 0.6, text: 'Bring the van to <em>Quill\'s Tow & Tune</em> in good shape.' },
      { type: 'dialogue', wait: true, lines: [[R, 'Clean van, clean plates. You\'re getting good at this. That worries me.']] },
    ],
  },
  {
    id: 'heist', type: 'heist', giver: 'harlan', letter: 'H', title: 'The Coal Vault Job', blurb: 'Choose your approach. Choose your crew.',
    start: { site: 'quill' }, requires: ['heist_setup'], suppressWanted: true, medals: { gold: 420, silver: 600 },
    payout: (v) => Math.round(BASE * (1 - (v.cut || 0)) * (v.approach === 'stealth' && !v.loud ? 1.15 : 1)),
    passNote: (v) => `${v.approach === 'stealth' ? (v.loud ? 'Stealth gone loud' : 'Clean stealth job') : 'Loud and proud'} · crew cut ${Math.round((v.cut || 0) * 100)}%`,
    callLine: 'Everything\'s ready. Your call how we do it.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[H, 'Two ways in. Loud: we drill the vault and fight our way out. Quiet: you crack the safe and nobody knows until Monday.']] },
      { type: 'choice', var: 'approach', title: 'Choose your approach', options: [
        { label: 'Loud', sub: 'Storm the office, drill the vault, 3-star getaway', value: 'loud' },
        { label: 'Stealthy', sub: 'Slip past security, crack the safe, +15% take if undetected', value: 'stealth' },
      ] },
      { type: 'choice', var: 'driver', title: 'Pick a getaway driver', subtitle: 'Their cut comes out of the take', options: [
        { label: 'Tick', sub: 'Talks too much, drives like a dream. Leaves a fast car at the scene.', right: '15%', value: 'tick', cut: 0.15, set: { fastCar: true } },
        { label: 'Lou Brandt', sub: 'Cheap. Drives a minivan like it\'s a hearse.', right: '5%', value: 'lou', cut: 0.05 },
      ] },
      { type: 'choice', var: 'hacker', title: 'Pick a safe cracker', subtitle: 'Faster cracking = less time exposed', options: [
        { label: 'Harlan Pryce', sub: 'Knows old locks better than anyone. Cracks 10 s faster.', right: '15%', value: 'harlan', cut: 0.15, set: { hackBonus: 10 } },
        { label: 'Penny Vance', sub: 'Reliable, a little slow.', right: '8%', value: 'penny', cut: 0.08, set: { hackBonus: 3 } },
      ] },
      { type: 'dialogue', lines: [[T, 'Whatever you picked, I\'m proud of you. Mostly.']] },
      { type: 'goto', to: { site: 'graves' }, radius: 40, text: 'Go to <em>Graves Holdings</em>.', checkpoint: true },
      { type: 'branch', var: 'approach', cases: {
        loud: [
          { type: 'clear', at: { site: 'graves' }, count: 6, text: 'Take out <em>security</em>.', checkpoint: true },
          { type: 'defend', at: { site: 'graves' }, duration: 45, waves: 2, perWave: 3, radius: 55, text: 'Hold off reinforcements while the <em>drill</em> works.' },
          { type: 'collect', at: { site: 'graves' }, count: 2, spread: 10, color: 0x7cff7c, text: 'Grab the <em>cash bags</em>.' },
          { type: 'getaway', stars: 3, text: '<em>Lose the cops</em> with the loot.', checkpoint: true },
        ],
        stealth: [
          { type: 'stealth', at: { site: 'graves' }, guardCount: 5, radius: 24, goal: 'hold', seconds: 30, failOnDetect: false, text: 'Crack the <em>safe</em> without being seen.', checkpoint: true },
          { type: 'branch', var: 'loud', cases: {
            true: [{ type: 'getaway', stars: 3, text: 'The alarm is ringing. <em>Lose the cops.</em>', checkpoint: true }],
            default: [{ type: 'getaway', stars: 1, text: 'A patrol saw you leave. <em>Lose the cop.</em>' }],
          } },
        ],
      } },
      { type: 'goto', to: { site: 'quill' }, radius: 10, text: 'Bring the loot to <em>Quill\'s Tow & Tune</em>.' },
      { type: 'dialogue', wait: true, lines: [[R, 'Deeds, ledgers and a lot of cash. Harlan\'s mailing the paperwork to the county.'], [D, 'And the money?'], [H, 'Some of it buys the park a lawyer. The rest is yours.']] },
    ],
  },
];
