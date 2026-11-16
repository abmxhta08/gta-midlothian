// BRAND_MODE: "real" shows real business names on signs, labels and pop-ups (private friends build).
// "parody" swaps them for invented names so the game can be shared publicly. Public places (schools, parks,
// neighbourhoods, streets, churches, fire stations) always keep their real names.
export const BRAND_MODE_DEFAULT = 'real';
let mode = BRAND_MODE_DEFAULT;
export const setBrandMode = (m) => { mode = m === 'parody' ? 'parody' : 'real'; };
export const getBrandMode = () => mode;

/** Real name (substring match, case-insensitive) -> parody name. */
export const PARODY = {
  'Kroger': 'Krogo Market', 'Publix': 'Pubstix', 'Food Lion': 'Food Lynx', 'Lidl': 'Lidel', 'Aldi': 'Aldo Grocer', 'Target': 'Tarjay',
  'Walmart': 'Wallymart', "Sam's Club": "Stan's Club", 'Starbucks': 'Starbrews', "McDonald's": "McDuffy's", 'Chick-fil-A': 'Chick-a-Lot',
  'Walgreens': 'Wellgreens', 'CVS': 'CVZ', 'Shell': 'Shelly', "Arby's": "Harby's", 'Dairy Queen': 'Dairy Monarch', 'Chipotle': 'Chipotlay',
  'Qdoba': 'Q-Dobra', "Dunkin": 'Dunkem', '7-Eleven': '6-Twelve', 'Little Caesars': 'Little Cleavers', 'Truist': 'Trustwell Bank',
  'YMCA': 'Y Fitness', 'Wawa': 'Wowa', 'Avis': 'Ravis Rentals', 'UPS Store': 'Parcel Hut', 'Long & Foster': 'Long & Faster Realty',
  'Mariner Finance': 'Seafarer Finance', 'Atlantic Union Bank': 'Atlantis Union Bank', 'First Citizens Bank': 'First Neighbors Bank',
  'Virginia Credit Union': 'Old Dominion Credit Union', 'Village Bank': 'Hamlet Bank', 'DaVita': 'VitaCare', 'Life Storage': 'LifeBox Storage',
  'ExtraSpace': 'ExtraRoom', 'American Family Fitness': 'All-American Gym', 'Lowe\'s': "Lowell's", 'Home Depot': 'Home Despot',
};
const PUBLIC = /school|college|park|church|chapel|cemetery|library|post office|fire|ems|station|village$|elementary|middle|high|county|hall|kingdom/i;
const ADJ = ['Coalfield', 'Turnpike', 'Colony', 'Winterfield', 'Bristol', 'Swift Creek', 'Old Mill', 'Brick House', 'Mine Shaft', 'Huguenot'];
const NOUN = { restaurant: 'Grill', fast_food: 'Bites', cafe: 'Coffee', hairdresser: 'Cuts', beauty: 'Studio', dentist: 'Dental', bank: 'Savings',
  clothes: 'Outfitters', supermarket: 'Market', convenience: 'Mart', fuel: 'Fuel', pharmacy: 'Drugs', bar: 'Tavern', pub: 'Pub', default: 'Co.' };

/** Name to display for a place. kind = OSM shop/amenity kind if known. */
export function brandName(name, kind = null) {
  if (!name || mode === 'real') return name;
  for (const [real, fake] of Object.entries(PARODY)) if (name.toLowerCase().includes(real.toLowerCase())) return name.replace(new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), fake);
  if (PUBLIC.test(name)) return name;
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${ADJ[h % ADJ.length]} ${NOUN[kind] || NOUN.default}`;
}
