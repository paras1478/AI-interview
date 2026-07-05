import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const outputSchema = z.object({
  feedback: z.string(),
  score: z.number().min(0).max(10),
});

const RESULT_PROMPT = `
 You are an expert evaluator. Your job is to evaluate the users interview. Give them a score out of 10
    and also let them know any feedback you have about thier interview.

    Please return only a json which looks like this - 

{
  "feedback": "string",
  "score": number
}

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