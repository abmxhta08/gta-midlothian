// Main story. Original characters and dialogue (see data/contacts.js). Sites: quill = Quill's Tow & Tune,
// tick = Tick's hangout near Village Marketplace, harlan = Harlan's spot at Mid-Lothian Mines Park,
// gravesLot = Graves Holdings storage lot, graves = Graves Holdings office. None are school campuses.
const R = 'Rosa', T = 'Tick', H = 'Harlan', D = 'Dex', V = 'Victor Graves';

export const STORY = [
  {
    id: 'homecoming', type: 'story', giver: 'rosa', letter: 'R', title: 'Homecoming', blurb: 'Six years gone. Rosa still owes you a ride.',
    start: { site: 'quill' }, payout: 500, medals: { gold: 150, silver: 240 }, suppressWanted: true,
    callLine: 'Dex Carver, back in Midlothian? Get down to the shop.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[R, 'Look who finally came home. You look like you slept in a bus station.'], [D, 'I did. Twice.'], [R, 'Take the loaner out back. Harlan wants to see you up at the old mines.']] },
      { type: 'spawnVehicle', var: 'loaner', vtype: 'sedan', at: { site: 'quill' }, color: 0x2a5d4a, mark: true },
      { type: 'enter', vehicle: 'loaner', text: 'Get in Rosa\'s <em>loaner</em>.' },
      { type: 'dialogue', lines: [[R, 'Bring it back in one piece. It\'s the only car I own that isn\'t held together with tape.']] },
      { type: 'deliver', vehicle: 'loaner', to: { name: 'Mines Park' }, radius: 12, text: 'Drive to <em>Mid-Lothian Mines Park</em>.', checkpoint: true },
      { type: 'dialogue', wait: true, lines: [[H, 'Dex. Your father mapped these tunnels, you know.'], [H, 'A developer named Victor Graves wants to pave this park over. He\'s buying up half the Turnpike with money that doesn\'t smell right.'], [D, 'Not my problem, Harlan.'], [H, 'It will be. Rosa\'s shop is on his list too.']] },
    ],
  },
  {
    id: 'repo', type: 'story', giver: 'rosa', letter: 'R', title: 'Repo Man', blurb: 'Rosa has a car to recover. The owner won\'t be thrilled.',
    start: { site: 'quill' }, requires: ['homecoming'], payout: 900, medals: { gold: 150, silver: 220 },
    callLine: 'Got a repo job. Easy money, mostly.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[R, 'Graves\' nephew skipped six payments on a purple muscle car. The bank wants it back.'], [R, 'Grab it and bring it here. Try not to dent it, I get paid by the panel.']] },
      { type: 'spawnVehicle', var: 'repo', vtype: 'muscle', at: { random: { min: 400, max: 800 } }, color: 0x6a1a8a, mark: true },
      { type: 'enter', vehicle: 'repo', text: 'Find and take the <em>purple muscle car</em>.', checkpoint: true },
      { type: 'wanted', stars: 1 },
      { type: 'dialogue', lines: [[D, 'Somebody called it in. Of course they did.']] },
      { type: 'deliver', vehicle: 'repo', to: { site: 'quill' }, minHealth: 0.4, text: 'Lose the heat and bring the car to <em>Quill\'s Tow & Tune</em>.', timer: 180 },
    ],
    outro: [[R, 'Not bad. Graves\' people will notice, though.']],
  },
  {
    id: 'tail', type: 'story', giver: 'tick', letter: 'T', title: 'Tail Light', blurb: 'Tick wants to know where Graves\' vans go at night.',
    start: { site: 'tick' }, requires: ['repo'], payout: 1200, medals: { gold: 160, silver: 240 }, suppressWanted: true,
    callLine: 'Dex! It\'s Tick. Got a hustle that needs a careful driver.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[T, 'Marcus Tillman. Everyone calls me Tick, because I never stop talking.'], [T, 'Graves runs a gray van up and down the Turnpike every day. Follow it. Don\'t get made.']] },
      { type: 'enter', text: 'Get a <em>vehicle</em>.' },
      { type: 'tail', vtype: 'van', color: 0x4a4f55, from: { near: { site: 'tick' }, dist: 140 }, via: [{ random: { min: 600, max: 900 } }], to: { site: 'gravesLot' }, speed: 12, min: 14, max: 110, text: 'Follow the <em>gray van</em>.', checkpoint: true },
      { type: 'dialogue', wait: true, lines: [[D, 'It went into a storage lot behind a warehouse.'], [T, 'Storage lot. For a guy who builds condos. Interesting.']] },
    ],
  },
  {
    id: 'snatch', type: 'story', giver: 'tick', letter: 'T', title: 'Snatch and Run', blurb: 'A courier on a motorcycle is carrying Graves\' ledger.',
    start: { site: 'tick' }, requires: ['tail'], payout: 1500, medals: { gold: 180, silver: 260 }, suppressWanted: true,
    callLine: 'Courier\'s rolling right now. Move!',
    steps: [
      { type: 'dialogue', wait: true, lines: [[T, 'Courier on a bike is taking Graves\' books across town. Run him down, gently.'], [T, 'Then grab the package. Nobody gets hurt worse than their pride.']] },
      { type: 'enter', text: 'Get a <em>vehicle</em>.' },
      { type: 'chase', var: 'bike', vtype: 'motorcycle', from: { near: { player: true }, dist: 160 }, speed: 20, health: 1, disableAt: 0.55, text: 'Stop the <em>courier\'s motorcycle</em>.', checkpoint: true },
      { type: 'knockout', var: 'courier', at: { var: 'bike' }, look: 'civilian', flees: true, health: 40, text: 'Catch and knock out the <em>courier</em> (fists, bat or stun grenade).' },
      { type: 'collect', at: { var: 'courier' }, count: 1, spread: 2, text: 'Grab the <em>package</em>.' },
      { type: 'dialogue', lines: [[T, 'Ledger says "Mines Park: phase two." He\'s not building condos. He\'s digging.']] },
    ],
  },
  {
    id: 'escort', type: 'story', giver: 'rosa', letter: 'R', title: 'Escort Duty', blurb: 'Rosa is hauling evidence across town. Graves knows.',
    start: { site: 'quill' }, requires: ['snatch'], payout: 2000, medals: { gold: 200, silver: 300 }, suppressWanted: true, protect: [],
    callLine: 'I need to move something and I need you riding shotgun.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[R, 'I\'m towing the purple car to Harlan\'s. The bank never wanted it back. Graves did.'], [R, 'There\'s something welded under the seat. Keep his crew off me.']] },
      { type: 'enter', text: 'Get a <em>vehicle</em> and follow Rosa.' },
      { type: 'escort', vtype: 'pickup', color: 0xd2a02a, from: { site: 'quill' }, to: { site: 'harlan' }, speed: 13, allyName: 'Rosa', attackerCount: 3, text: 'Protect <em>Rosa\'s tow truck</em>.', checkpoint: true },
      { type: 'dialogue', wait: true, lines: [[R, 'Made it. Barely. Remind me to charge Harlan for gas.'], [H, 'Core samples. Coal seam maps. Graves is going to strip-mine under the park.']] },
    ],
  },
  {
    id: 'paper', type: 'story', giver: 'harlan', letter: 'H', title: 'Paper Trail', blurb: 'Get proof from the Graves storage lot without being seen.',
    start: { site: 'harlan' }, requires: ['escort'], payout: 2500, medals: { gold: 240, silver: 360 }, suppressWanted: true,
    callLine: 'Quietly, Dex. The county needs paper, not noise.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[H, 'The permits he filed are fake. The real plans are in that storage lot.'], [H, 'Photograph three documents. If a guard sees you, walk away. We get one shot at this.']] },
      { type: 'goto', to: { site: 'gravesLot' }, radius: 45, text: 'Go to the <em>Graves storage lot</em>.', checkpoint: true },
      { type: 'stealth', at: { site: 'gravesLot' }, guardCount: 4, radius: 26, goal: 'collect', count: 3, spread: 18, failOnDetect: true, text: 'Photograph the documents (press <em>E</em>). Stay out of sight; cover (<em>C</em>) helps.', checkpoint: true },
      { type: 'goto', to: { site: 'harlan' }, radius: 8, text: 'Bring the photos to <em>Harlan</em>.' },
      { type: 'dialogue', wait: true, lines: [[H, 'This is it. Forged permits, fake surveys.'], [H, 'He\'ll know it was us by morning.']] },
    ],
  },
  {
    id: 'hold', type: 'story', giver: 'rosa', letter: 'R', title: 'Hold the Shop', blurb: 'Graves sends his crew to Quill\'s Tow & Tune.',
    start: { site: 'quill' }, requires: ['paper'], payout: 3000, medals: { gold: 140, silver: 200 }, suppressWanted: true,
    callLine: 'They\'re coming for the shop. Get here now!',
    steps: [
      { type: 'dialogue', wait: true, lines: [[R, 'Three SUVs just pulled up across the road. I\'m not losing this shop, Dex.'], [D, 'Get inside. I\'ve got it.']] },
      { type: 'defend', at: { site: 'quill' }, duration: 75, waves: 3, perWave: 4, radius: 60, text: 'Defend <em>Quill\'s Tow & Tune</em>.', checkpoint: true },
      { type: 'dialogue', wait: true, lines: [[R, 'That\'s the last of them. My windows, though.'], [T, 'Graves has a vault in his office on the Turnpike. Everything\'s in there. Harlan has a plan.']] },
    ],
  },
  {
    id: 'finale', type: 'story', giver: 'tick', letter: 'T', title: 'Last Shift', blurb: 'Victor Graves is running. End it.',
    start: { site: 'tick' }, requires: ['heist'], payout: 10000, medals: { gold: 300, silver: 450 }, suppressWanted: true, ending: true,
    callLine: 'Graves is skipping town. It\'s now or never.',
    steps: [
      { type: 'dialogue', wait: true, lines: [[T, 'Graves found out the vault\'s empty. He\'s loading a black SUV and heading for the county line.'], [D, 'Then we take him in. Not out. In.']] },
      { type: 'enter', text: 'Get a <em>vehicle</em>.' },
      { type: 'chase', var: 'suv', vtype: 'suv', color: 0x0d0d10, from: { near: { player: true }, dist: 130 }, speed: 21, disableAt: 0.35, text: 'Stop <em>Victor Graves\' SUV</em>.', checkpoint: true },
      { type: 'dialogue', lines: [[V, 'You have no idea how much this town owes me, Carver!']] },
      { type: 'clear', at: { var: 'suv' }, count: 4, text: 'Take down Graves\' <em>bodyguards</em>.', checkpoint: true },
      { type: 'knockout', var: 'graves', at: { var: 'suv' }, look: 'vip', flees: true, health: 90, text: 'Catch <em>Victor Graves</em> and knock him out.' },
      { type: 'dropoff', var: 'graves', to: { place: 'police' }, text: 'Deliver Graves to the <em>police substation</em>.' },
      { type: 'dialogue', wait: true, lines: [[R, 'County pulled every one of his permits this morning.'], [H, 'The park stays a park. Your father would\'ve liked that.'], [T, 'So... same time next week?'], [D, 'Midlothian. Never a dull shift.']] },
    ],
  },
];
