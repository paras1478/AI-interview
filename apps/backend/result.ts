import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const outputSchema = z.object({
  feedback: z.string(),
  score: z.number().min(0).max(10),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  questions: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      verdict: z.enum(["correct", "partial", "incorrect"]),
      suggestion: z.string(),
    })
  ),
});

const RESULT_PROMPT = `
You are an expert technical interviewer evaluating a completed interview transcript.

Your job:
1. Identify each distinct technical question the interviewer asked and the candidate's corresponding answer.
2. For each question/answer pair, judge whether the answer was "correct", "partial", or "incorrect", and give a short, actionable suggestion for how the candidate could improve that specific answer.
3. Summarize the candidate's overall strengths (what they did well) and weaknesses (what they should work on) across the whole interview.
4. Give an overall score out of 10 and overall feedback summarizing the interview.

Return ONLY a JSON object with exactly this shape:

{
  "feedback": "string - overall feedback summary",
  "score": number (0-10),
  "strengths": ["string", ...],
  "weaknesses": ["string", ...],
  "questions": [
    {
      "question": "string - the question asked",
      "answer": "string - the candidate's answer",
      "verdict": "correct" | "partial" | "incorrect",
      "suggestion": "string - how to improve this answer"
    }
  ]
}

Only include entries in "questions" for actual technical questions asked by the interviewer (skip greetings/small talk). If the candidate gave no answer to a question, still include it with verdict "incorrect" and note that no answer was given.

Interview Transcript:
{{USER_TRANSCRIPT}}
`;

export async function calculateResult(
  messages: {
    type: "Assistant" | "User";
    message: string;
    createdAt: Date;
  }[]
) {
  const prompt = RESULT_PROMPT.replace(
    "{{USER_TRANSCRIPT}}",
    JSON.stringify(messages, null, 2)
  );

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]!.message.content ?? "{}";

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  const result = outputSchema.parse(JSON.parse(cleaned));

  return result;
}
