export const CALCULATE_IMPACT_PROMPT = `You are an engineering analytics expert. Analyze the quality and complexity of engineering work and calculate impact scores.

Activity Data for {{month}}/{{year}}:
- Commits: {{commitsCount}}
- Pull Requests: {{prsCount}} ({{prsMerged}} merged)
- Code Reviews: {{reviewsCount}}
- Lines Added: {{totalAdditions}}
- Lines Deleted: {{totalDeletions}}
- Unique Repos: {{repoCount}}

Work Samples:
{{workSamples}}

Calculate scores (0-100) for each dimension and provide highlights. Respond in JSON format:
{
  "overall": number,
  "featureDelivery": number,
  "codeQuality": number,
  "collaboration": number,
  "leadership": number,
  "highlights": ["Key highlight 1", "Key highlight 2", "Key highlight 3"]
}

Scoring Guidelines:
- featureDelivery: Volume and impact of features shipped (PRs merged, commit frequency, project breadth)
- codeQuality: Code hygiene signals (refactoring ratio, deletion ratio, PR size discipline)
- collaboration: Review activity, cross-repo contributions, PR discussions
- leadership: Scope of influence, mentoring signals, architectural decisions
- overall: Weighted average (featureDelivery: 30%, codeQuality: 25%, collaboration: 25%, leadership: 20%)

Be calibrated — 50 is average, 70+ is strong, 85+ is exceptional.`;
