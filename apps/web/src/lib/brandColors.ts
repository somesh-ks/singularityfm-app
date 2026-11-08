import { readFileSync } from "node:fs";

/**
 * sRGB values for the places that cannot take OKLCH: the theme-color meta, the manifest and the app
 * icon. They are read from the generated footer of tokens.css, so they can never drift from the
 * design tokens.
 */
export interface BrandColors {
  surfaceLight: string;
  surfaceDark: string;
  accentLight: string;
  accentDark: string;
}

const FOOTER_PATTERNS = {
  surface:
    /theme-color and manifest background \(surface\): light (#[0-9a-f]{6}), dark (#[0-9a-f]{6})/i,
  accent: /accent: light (#[0-9a-f]{6}), dark (#[0-9a-f]{6})/i,
} as const;

export function parseBrandColors(tokensCss: string): BrandColors {
  const surface = FOOTER_PATTERNS.surface.exec(tokensCss);
  const accent = FOOTER_PATTERNS.accent.exec(tokensCss);
  if (!surface?.[1] || !surface[2] || !accent?.[1] || !accent[2]) {
    throw new Error("tokens.css has no derived sRGB footer. Run: npx tsx scripts/buildTokens.ts");
  }
  return {
    surfaceLight: surface[1].toLowerCase(),
    surfaceDark: surface[2].toLowerCase(),
    accentLight: accent[1].toLowerCase(),
    accentDark: accent[2].toLowerCase(),
  };
}

/** For a script run outside the site's bundle (buildIcons.ts); a page imports the file's text instead. */
export function readBrandColors(tokensPath: string): BrandColors {
  return parseBrandColors(readFileSync(tokensPath, "utf8"));
}
