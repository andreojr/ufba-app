// The "bold pop" DiceBear preset — a fixed, vibrant background palette so every
// generated avatar reads as part of the same set instead of a random hue per seed.
export const BOLD_POP_BACKGROUND_COLORS = ["ff8fab", "ffb703", "4cc9a7", "4d96ff", "b57bff"];

export function buildAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/open-peeps/svg?seed=${seed}&backgroundColor=${BOLD_POP_BACKGROUND_COLORS.join(",")}`;
}
