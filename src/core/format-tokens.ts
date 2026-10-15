/** Keep small usage counts exact; abbreviate thousands in the footer. */
export function formatTokens(tokens: number): string {
  return tokens < 1000
    ? `${String(tokens)} tok`
    : `${(tokens / 1000).toFixed(1)}K`;
}
