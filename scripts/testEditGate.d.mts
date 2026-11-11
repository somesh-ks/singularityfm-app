export declare const LABEL: string;
/** The existing tests a change edits: lines removed, a test deleted, a screenshot changed. */
export declare function editedTests(
  files: { path: string; status: string; deleted: number }[],
): string[];
