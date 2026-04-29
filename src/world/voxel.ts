// Each voxel represents this many world meters per side. Bigger blocks read
// as deliberate "block flight" aesthetic at altitude instead of pixelated noise.
export const VOXEL_SIZE = 2;

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  SNOW: 5,
  WATER: 6,
  ASPHALT: 7,
  RUNWAY_LINE: 8,
  WOOD: 9,
  LEAF: 10,
  APRON_DIRT: 11,
  // Biome-specific surface blocks
  TUNDRA_MOSS: 12,
  RED_ROCK: 13,
  WHEAT: 14,
  FOREST_FLOOR: 15,
  ICE: 16,
  // Variant blocks for in-biome color richness (broken patches)
  WHEAT_DRY: 17,
  FOREST_BRIGHT: 18,
  TUNDRA_SNOW_PATCH: 19,
  RED_ROCK_DARK: 20,
  // New biome surface blocks
  SAVANNA_GRASS: 21,     // yellow-orange dry grass
  TAIGA_DIRT: 22,        // dark damp earth (cool conifer forest floor)
  SWAMP_GRASS: 23,       // murky dark green
  // Vegetation variants
  LEAF_SNOWY: 24,        // snow-frosted leaf
  CACTUS: 25,            // green desert cactus
  LEAF_PINE: 26,         // dark spruce green
  LEAF_ACACIA: 27,       // muted yellow-green acacia
  WHEAT_CROP: 28,        // planted wheat crop (farm field)
  FARM_DIRT: 29,         // dark plowed dirt rows
  // Tropical archipelago
  WHITE_SAND: 30,        // bright reef sand
  TROPICAL_LAGOON: 31,   // shallow turquoise water
  PALM_LEAF: 32,         // palm frond
  PALM_TRUNK: 33,        // light bark palm trunk
  // Biome v2: distinct surfaces for the new biomes
  BADLANDS_LAYER_A: 34,  // banded mesa rock — bright orange
  BADLANDS_LAYER_B: 35,  // banded mesa rock — deeper red
  BADLANDS_TOP: 36,      // top of mesa, slightly green
  BEACH_SAND: 37,        // bright pale beach sand
  ICE_PACK: 38,          // frozen ocean surface
  CHERRY_GRASS: 39,      // pink-tinted grass
  LEAF_CHERRY: 40,       // pink cherry blossom leaf
  JUNGLE_GRASS: 41,      // saturated dark jungle floor
  LEAF_JUNGLE: 42,       // bright tropical leaf
  MOUNTAIN_STONE: 43,    // alpine grey
  MOUNTAIN_GRASS: 44,    // mountain meadow
  VOLCANIC_ROCK: 45,     // black volcanic basalt
  LAVA: 46,              // glowing red-orange (visual only)
  ROCK_ARCH: 47,         // sandstone for arches (warm tan)
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export function isSolid(id: number): boolean {
  return id !== BLOCK.AIR && id !== BLOCK.WATER && id !== BLOCK.TROPICAL_LAGOON;
}

export const BLOCK_COLOR: Record<number, [number, number, number]> = {
  // Saturated palette — biome surfaces should be visually distinct from
  // cruise altitude. Forest greens lean vivid, deserts lean orange, snow
  // is bright, jungle is deep saturated green, badlands are punchy red.
  [BLOCK.GRASS]: [0.36, 0.68, 0.28],
  [BLOCK.DIRT]: [0.48, 0.32, 0.20],
  [BLOCK.STONE]: [0.56, 0.56, 0.60],
  [BLOCK.SAND]: [0.92, 0.82, 0.50],
  [BLOCK.SNOW]: [0.97, 0.98, 1.00],
  [BLOCK.WATER]: [0.18, 0.42, 0.68],
  [BLOCK.ASPHALT]: [0.78, 0.78, 0.80],
  [BLOCK.RUNWAY_LINE]: [0.18, 0.18, 0.22],
  [BLOCK.WOOD]: [0.34, 0.22, 0.13],
  [BLOCK.LEAF]: [0.20, 0.50, 0.20],
  [BLOCK.APRON_DIRT]: [0.34, 0.40, 0.22],
  // Biome surfaces
  [BLOCK.TUNDRA_MOSS]: [0.50, 0.58, 0.42],
  [BLOCK.RED_ROCK]: [0.78, 0.40, 0.20],
  [BLOCK.WHEAT]: [0.84, 0.72, 0.30],
  [BLOCK.FOREST_FLOOR]: [0.20, 0.40, 0.20],
  [BLOCK.ICE]: [0.78, 0.92, 0.96],
  // Variants
  [BLOCK.WHEAT_DRY]: [0.72, 0.62, 0.32],
  [BLOCK.FOREST_BRIGHT]: [0.36, 0.58, 0.26],
  [BLOCK.TUNDRA_SNOW_PATCH]: [0.82, 0.86, 0.84],
  [BLOCK.RED_ROCK_DARK]: [0.60, 0.30, 0.22],
  [BLOCK.SAVANNA_GRASS]: [0.78, 0.66, 0.26],
  [BLOCK.TAIGA_DIRT]: [0.28, 0.36, 0.22],
  [BLOCK.SWAMP_GRASS]: [0.30, 0.42, 0.24],
  [BLOCK.LEAF_SNOWY]: [0.86, 0.90, 0.88],
  [BLOCK.CACTUS]: [0.30, 0.58, 0.24],
  [BLOCK.LEAF_PINE]: [0.12, 0.30, 0.16],
  [BLOCK.LEAF_ACACIA]: [0.58, 0.62, 0.20],
  [BLOCK.WHEAT_CROP]: [0.88, 0.76, 0.30],
  [BLOCK.FARM_DIRT]: [0.36, 0.26, 0.16],
  // Tropical
  [BLOCK.WHITE_SAND]: [0.97, 0.93, 0.78],
  [BLOCK.TROPICAL_LAGOON]: [0.28, 0.80, 0.80],
  [BLOCK.PALM_LEAF]: [0.32, 0.62, 0.20],
  [BLOCK.PALM_TRUNK]: [0.55, 0.42, 0.30],
  // New biome surfaces
  [BLOCK.BADLANDS_LAYER_A]: [0.84, 0.46, 0.22],   // bright orange
  [BLOCK.BADLANDS_LAYER_B]: [0.62, 0.30, 0.18],   // deep red
  [BLOCK.BADLANDS_TOP]: [0.62, 0.52, 0.30],       // dusty olive
  [BLOCK.BEACH_SAND]: [0.96, 0.92, 0.74],         // brighter than regular sand
  [BLOCK.ICE_PACK]: [0.74, 0.86, 0.94],           // pale blue-white
  [BLOCK.CHERRY_GRASS]: [0.86, 0.66, 0.74],       // pink-soil tint
  [BLOCK.LEAF_CHERRY]: [0.96, 0.62, 0.78],        // cherry blossom pink
  [BLOCK.JUNGLE_GRASS]: [0.20, 0.56, 0.18],       // deep saturated jungle
  [BLOCK.LEAF_JUNGLE]: [0.18, 0.62, 0.20],        // bright tropical
  [BLOCK.MOUNTAIN_STONE]: [0.62, 0.62, 0.66],     // cool grey
  [BLOCK.MOUNTAIN_GRASS]: [0.42, 0.54, 0.30],     // alpine meadow
  [BLOCK.VOLCANIC_ROCK]: [0.18, 0.16, 0.18],      // black basalt
  [BLOCK.LAVA]: [0.92, 0.36, 0.10],               // glowing
  [BLOCK.ROCK_ARCH]: [0.78, 0.58, 0.34],          // warm tan sandstone
};
