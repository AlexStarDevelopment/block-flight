// Plane paint schemes — colors applied to the plane mesh's three material
// groups (fuselage primary, wing secondary, accent for cowl/struts).

export interface Skin {
  id: string;
  name: string;
  cost: number;
  primary: number;        // fuselage / main body color
  secondary: number;      // wing / lighter body color
  accent: number;         // engine cowl + control struts
  surface: number;        // control surfaces (ailerons, elevator, rudder)
}

export const SKINS: Skin[] = [
  {
    id: 'cub_yellow',
    name: 'Classic Yellow',
    cost: 0,
    primary: 0xd9b04a, secondary: 0xe6c466, surface: 0xc9a14a, accent: 0x222226,
  },
  {
    id: 'bush_red',
    name: 'Bush Red',
    cost: 500,
    primary: 0xc23a2a, secondary: 0xd95040, surface: 0xa82e22, accent: 0x222226,
  },
  {
    id: 'arctic_white',
    name: 'Arctic White',
    cost: 750,
    primary: 0xeeeeee, secondary: 0xfafafa, surface: 0xcccccc, accent: 0x2a3540,
  },
  {
    id: 'forest_green',
    name: 'Forest Green',
    cost: 750,
    primary: 0x355e3b, secondary: 0x4a7048, surface: 0x2e4a30, accent: 0x1a1a1a,
  },
  {
    id: 'sunset_orange',
    name: 'Sunset Orange',
    cost: 1000,
    primary: 0xe25a1c, secondary: 0xf07a30, surface: 0xc24a18, accent: 0x222226,
  },
  {
    id: 'navy_blue',
    name: 'Navy Blue',
    cost: 1000,
    primary: 0x1c3358, secondary: 0x2e4870, surface: 0x152848, accent: 0x4a4a4a,
  },
  {
    id: 'black_ops',
    name: 'Black Ops',
    cost: 2500,
    primary: 0x1a1a1c, secondary: 0x252528, surface: 0x101012, accent: 0xc8b340,
  },
  {
    id: 'camo',
    name: 'Camo',
    cost: 2500,
    primary: 0x4a5a32, secondary: 0x6a6a40, surface: 0x3a4a28, accent: 0x222218,
  },
  {
    id: 'racing',
    name: 'Racing Stripe',
    cost: 3000,
    primary: 0xfafafa, secondary: 0xe54040, surface: 0xeeeeee, accent: 0x222226,
  },
  {
    id: 'vintage',
    name: 'Vintage Cream',
    cost: 3500,
    primary: 0xece0c0, secondary: 0xd5b888, surface: 0xc4a878, accent: 0x4a3220,
  },
];

export function getSkin(id: string): Skin {
  return SKINS.find(s => s.id === id) ?? SKINS[0];
}
