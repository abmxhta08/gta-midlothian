// Shop inventories. Outfits are colour presets for the player model (all invented clothing).
export const OUTFITS = [
  { id: 'default', name: 'Olive Jacket', price: 0, o: { top: 0x2f3a2a, bottom: 0x2b3346, shoe: 0xeeeeee, sleeves: false } },
  { id: 'street', name: 'Street Hoodie', price: 120, o: { top: 0x1c1c1e, bottom: 0x3a4a6a, shoe: 0xd23a2a, sleeves: false } },
  { id: 'business', name: 'Business Casual', price: 300, o: { top: 0xe8e8ea, bottom: 0x1f2533, shoe: 0x3a2618, sleeves: false } },
  { id: 'athletic', name: 'Track Suit', price: 150, o: { top: 0x1f5fb0, bottom: 0x1f5fb0, shoe: 0xffffff, sleeves: false } },
  { id: 'work', name: 'Hi-Vis Workwear', price: 90, o: { top: 0xf2c21b, bottom: 0x4a4036, shoe: 0x5a3a20, sleeves: false } },
  { id: 'night', name: 'Night Out', price: 260, o: { top: 0x6a1a2a, bottom: 0x111111, shoe: 0x111111, sleeves: false } },
  { id: 'summer', name: 'Summer Tee', price: 80, o: { top: 0xf2a65a, bottom: 0x8a7a5a, shoe: 0xeeeeee, sleeves: true } },
  { id: 'miner', name: 'Coal Miner Heritage', price: 0, unlock: 'collectibles', o: { top: 0x3a3226, bottom: 0x2a2a2a, shoe: 0x1a1a1a, hairStyle: 0.85 } },
];
export const SNACKS = [
  { id: 'coffee', name: 'Coffee & Donut', price: 10, heal: 25 },
  { id: 'meal', name: 'Hot Meal', price: 25, heal: 60 },
  { id: 'energy', name: 'Energy Drink', price: 15, heal: 15, stamina: true },
];
export const PAINTS_SHOP = [
  { name: 'Midnight Black', hex: 0x111214 }, { name: 'Pearl White', hex: 0xf4f4f4 }, { name: 'Racing Red', hex: 0xb01818 },
  { name: 'Ocean Blue', hex: 0x1f5fb0 }, { name: 'Forest Green', hex: 0x1d4a2a }, { name: 'Sunset Orange', hex: 0xe0701a },
  { name: 'Gunmetal', hex: 0x4a4f55 }, { name: 'Royal Purple', hex: 0x5a2a8a },
];
export const PAINT_PRICE = 250, REPAIR_PRICE = 60, ARMOR_PRICE = 500;
