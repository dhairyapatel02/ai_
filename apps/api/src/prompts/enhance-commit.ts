export const ENHANCE_COMMIT_PROMPT = `You are an expert engineering career coach. Transform the following raw git commit message into a professional achievement statement suitable for a resume or performance review.

Context:
- Repository: {{repo}}
- Lines added: {{additions}}
- Lines deleted: {{deletions}}

Raw commit message: {{message}}

Respond in JSON format:
{
  "enhanced": "A professional, impactful description of this work (1-2 sentences, use action verbs, quantify where possible)",
  "category": "feature|bugfix|refactor|performance|infra"
}

Rules:
- Use strong action verbs (Engineered, Implemented, Optimized, Resolved, etc.)
- Quantify impact where the data supports it
- Focus on business value and technical achievement
- Keep it concise but impactful`;
