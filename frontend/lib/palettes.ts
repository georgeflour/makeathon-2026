export interface Palette {
  name: string;
  label: string;
  description: string;
  colors: string[];
  primary: string;
  above: string;
  below: string;
}

export const PALETTES: Record<string, Palette> = {
  ocean: {
    name: "ocean",
    label: "Ocean",
    description: "Cool blues & teals",
    colors: ["#3B82F6", "#06B6D4", "#6366F1", "#0EA5E9", "#8B5CF6", "#22D3EE", "#4F46E5", "#0284C7"],
    primary: "#3B82F6",
    above: "#6366F1",
    below: "#06B6D4",
  },
  sunset: {
    name: "sunset",
    label: "Sunset",
    description: "Warm oranges & pinks",
    colors: ["#F97316", "#EF4444", "#EC4899", "#F59E0B", "#FB923C", "#F43F5E", "#FBBF24", "#E11D48"],
    primary: "#F97316",
    above: "#EC4899",
    below: "#F59E0B",
  },
  forest: {
    name: "forest",
    label: "Forest",
    description: "Natural greens",
    colors: ["#10B981", "#22C55E", "#84CC16", "#14B8A6", "#16A34A", "#65A30D", "#0D9488", "#4ADE80"],
    primary: "#10B981",
    above: "#22C55E",
    below: "#14B8A6",
  },
  lavender: {
    name: "lavender",
    label: "Lavender",
    description: "Soft purples & violets",
    colors: ["#8B5CF6", "#A78BFA", "#C084FC", "#7C3AED", "#9333EA", "#D946EF", "#6D28D9", "#E879F9"],
    primary: "#8B5CF6",
    above: "#7C3AED",
    below: "#C084FC",
  },
  midnight: {
    name: "midnight",
    label: "Midnight",
    description: "Deep navy & indigo",
    colors: ["#2563EB", "#1D4ED8", "#4338CA", "#1E40AF", "#3730A3", "#6366F1", "#1E3A8A", "#312E81"],
    primary: "#2563EB",
    above: "#1E40AF",
    below: "#4338CA",
  },
  mono: {
    name: "mono",
    label: "Mono",
    description: "Classic grayscale",
    colors: ["#374151", "#6B7280", "#9CA3AF", "#1F2937", "#4B5563", "#D1D5DB", "#111827", "#E5E7EB"],
    primary: "#374151",
    above: "#1F2937",
    below: "#6B7280",
  },
};

export const DEFAULT_PALETTE = PALETTES.ocean;

export function getPalette(name?: string | null): Palette {
  return (name && PALETTES[name]) || DEFAULT_PALETTE;
}
