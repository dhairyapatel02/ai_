export const GENERATE_APPRAISAL_PROMPT = `You are an expert at writing engineering performance appraisals. Generate a structured appraisal document based on the following engineering activity data.

Period: {{period}} ({{month}}/{{year}})

Activity Summary:
- Total Commits: {{commitsCount}}
- Pull Requests: {{prsCount}} ({{prsMerged}} merged)
- Code Reviews: {{reviewsCount}}
- Repositories Contributed To: {{repoCount}}

Key Contributions:
{{contributions}}

Sample Work:
{{sampleWork}}

Generate a comprehensive appraisal report. Respond in JSON format:
{
  "executiveSummary": "2-3 sentence high-level summary of the period",
  "keyContributions": [
    { "title": "Contribution title", "evidence": "Specific evidence from the data" }
  ],
  "metrics": {
    "prCount": number,
    "reviewCount": number,
    "featuresShipped": number,
    "commitsCount": number
  },
  "areasOfImpact": ["Area 1 with description", "Area 2 with description"],
  "growthAndLearning": ["Growth area 1", "Growth area 2"],
  "goalsForNextPeriod": ["Goal 1", "Goal 2", "Goal 3"]
}

Guidelines:
- Be specific and evidence-based
- Highlight patterns of excellence
- Identify growth areas constructively
- Set ambitious but achievable goals
- Use professional, confident language`;
