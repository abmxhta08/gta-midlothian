// Repeatable side jobs (blue markers). type 'side' = no retry menu, can be replayed after a cooldown.
export const SIDE = [
  {
    id: 'side_delivery', type: 'side', letter: 'D', title: 'Special Delivery', blurb: 'Pick up a package and get it there on time.',
    start: { name: 'Midlothian Village Square' }, payout: 600, medals: { gold: 120, silver: 170 },
    steps: [
      { type: 'goto', to: { random: { min: 250, max: 650 } }, radius: 5, text: 'Pick up the <em>package</em>.' },
      { type: 'goto', to: { random: { min: 500, max: 1100 } }, radius: 6, text: 'Deliver the <em>package</em>.', timer: 140 },
    ],
  },
  {
    id: 'side_race', type: 'side', letter: 'R', title: 'Street Race', blurb: 'Three local racers. One finish line.', needsVehicle: true,
    start: { name: 'Ivymont Square' }, medals: { gold: 75, silver: 95 },
    payout: (v) => [1500, 800, 400, 0][Math.min(3, (v.place || 4) - 1)], passNote: (v) => `Finished ${['1st', '2nd', '3rd', '4th'][Math.min(3, (v.place || 4) - 1)]}`,
    steps: [{ type: 'race', opponents: 3, min: 1100, max: 1800, aiSpeed: 25, text: 'Win the <em>race</em>.' }],
  },
  {
    id: 'side_taxi', type: 'side', letter: 'T', title: 'Fare Game', blurb: 'Three passengers, three destinations.', needsVehicle: true,
    start: { name: 'Charter Colony Shopping Center' }, payout: 250,
    steps: [{ type: 'taxi', fares: 3, ownTimer: true }],
    passNote: (v) => `$${v.earned || 0} in fares`,
  },
  {
    id: 'side_bounty', type: 'side', letter: 'B', title: 'Bounty Hunter', blurb: 'Bring them in alive. That\'s the job.',
    start: { place: 'police' }, payout: 1200,
    steps: [
      { type: 'dialogue', lines: [['Dispatch', 'Skip with a warrant for insurance fraud. Alive, please. Paperwork is lighter.']] },
      { type: 'knockout', var: 'skip', at: { random: { min: 300, max: 800, combat: true } }, look: 'gang', fights: true, flees: false, health: 80, text: 'Find the <em>bounty</em> and knock them out.' },
      { type: 'dropoff', var: 'skip', to: { place: 'police' }, text: 'Drop the bounty at the <em>police substation</em>.' },
    ],
  },
  {
    id: 'side_repo', type: 'side', letter: 'W', title: 'Tow & Repo', blurb: 'Rosa has another car that needs "collecting".',
    start: { site: 'quill' }, payout: 700, medals: { gold: 150, silver: 220 },
    steps: [
      { type: 'spawnVehicle', var: 'repo', vtype: 'sedan', at: { random: { min: 300, max: 800 } }, color: 0x1f5fb0, mark: true },
      { type: 'enter', vehicle: 'repo', text: 'Repossess the <em>blue sedan</em>.' },
      { type: 'deliver', vehicle: 'repo', to: { site: 'quill' }, minHealth: 0.4, text: 'Bring it to <em>Quill\'s Tow & Tune</em> without wrecking it.' },
    ],
  },
  {
    id: 'side_heat', type: 'side', letter: 'H', title: 'Heat Wave', blurb: 'The cops are after you. Lose them.',
    start: { name: 'Midlothian Village Park' }, payout: 1200,
    steps: [{ type: 'getaway', stars: 3, text: '<em>Lose the cops.</em>' }],
  },
  {
    id: 'streetrace_challenge', type: 'side', title: 'Street Race Challenge', blurb: 'A local racer bets you $200 you can\'t beat them.', needsVehicle: true,
    payout: 400, onFail: (g) => { g.addMoney(-200); g.hud.toast('Lost the $200 bet'); },
    steps: [
      { type: 'dialogue', lines: [['Racer', 'Nice ride. Two hundred says mine\'s faster.']] },
      { type: 'race', opponents: 1, rival: true, needPlace: 1, min: 700, max: 1100, aiSpeed: 27, text: 'Beat the <em>challenger</em>.' },
    ],
  },
];
