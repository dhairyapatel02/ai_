export const GENERATE_PROMOTION_PROMPT = `You are an expert at writing promotion packets for software engineers. Build a compelling promotion evidence document.

Current Role: {{currentRole}}
Target Role: {{targetRole}}

Engineering Activity (last 6 months):
- Total Commits: {{commitsCount}}
- Pull Requests: {{prsCount}} ({{prsMerged}} merged)
- Code Reviews: {{reviewsCount}}
- Repositories: {{repoCount}}
- Average PR Size: {{avgPRSize}} lines

Notable Work:
{{notableWork}}

Collaboration Evidence:
{{collaborationEvidence}}

Generate a promotion packet. Respond in JSON format:
{
  "whyReady": "2-3 paragraph argument for why this engineer is ready for {{targetRole}}",
  "leadershipEvidence": ["Evidence point 1", "Evidence point 2"],
  "technicalImpact": ["Impact 1 with metrics", "Impact 2 with metrics"],
  "businessValue": ["Business value 1", "Business value 2"],
  "mentorship": ["Mentorship/collaboration evidence 1", "Evidence 2"],
  "supportingData": {
    "totalContributions": number,
    "crossTeamCollaboration": number,
    "technicalComplexity": "high|medium|low",
    "consistency": "A brief assessment of work consistency"
  }
}

Guidelines:
- Focus on evidence that demonstrates readiness for the TARGET role
- Emphasize scope expansion and increasing responsibility
- Quantify impact wherever possible
- Show leadership through code reviews and collaboration
- Highlight technical decision-making and ownership`;
