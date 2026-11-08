export declare const LABEL: string;
export declare const SYSTEM_PATHS: string[];
/** The lists that excuse code from a design-system check, by the file that holds them. */
export declare const ALLOWLISTS: Record<string, string[]>;
export declare function listEntries(text: string, name: string): string[] | undefined;
export declare function allowlistAdditions(
  before: string,
  after: string,
  lists: string[],
): string[];
export declare function checkDesignSystemPr(input: {
  files: string[];
  labels: string[];
  /** What the pull request adds to the allowlists, as "LIST: entry". */
  added?: string[];
}): string[];
/** What one app still takes from another app's folder, as "file: specifier"; the list only shrinks. */
export declare const CROSS_APP_IMPORTS: string[];
/** Imports in an app that reach another app. */
export declare function appBoundaryProblems(
  sources: { file: string; text: string }[],
  allowed?: string[],
): string[];
/** Every source file and stylesheet under apps/web and apps/admin (read from `root`). */
export declare function appSources(root: string): { file: string; text: string }[];
