import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { Readable } from "stream";
import { PreInterviewBody } from "./types";
import { scrapeGithub } from "./scrapers/github";
import cors from "cors";
import { prisma } from "./db";
import { calculateResult } from "./result";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function toWav(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const input = Readable.from(buffer);
    const stream = ffmpeg(input)
      .inputFormat("webm")
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("error", (err: Error) => reject(err))
      .pipe() as NodeJS.ReadableStream;

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (err: Error) => reject(err));
  });
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

app.use(express.json());
app.use(cors());

console.log("Backend started");
console.log("KEY:", process.env.OPENAI_API_KEY?.slice(0, 15));
console.log("LENGTH:", process.env.OPENAI_API_KEY?.length);

app.get("/test-key", async (_, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
    });
    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.post("/api/v1/pre-interview", async (req, res) => {
  const { success, data } = PreInterviewBody.safeParse(req.body);
  if (!success) return res.status(411).json({ message: "Incorrect body" });

  const githubUrl = data.github.endsWith("/") ? data.github.slice(0, -1) : data.github;
  const githubUsername = githubUrl.split("/").pop()!;
  const githubData = await scrapeGithub(githubUsername);

  const interview = await prisma.interview.create({
    data: { githubMetadata: JSON.stringify(githubData), status: "Pre" },
  });

  res.json({ id: interview.id });
});

// Returns the system prompt / interview context for a given interview
app.get("/api/v1/interview/:interviewId/context", async (req, res) => {
  const { interviewId } = req.params;
  const interview = await prisma.interview.findFirst({ where: { id: interviewId } });
  if (!interview) return res.status(404).json({ message: "Interview not found" });

  // Return prior messages so frontend can maintain conversation history
  const messages = await prisma.message.findMany({
    where: { interviewId },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    githubMetadata: interview.githubMetadata,
    messages: messages.map((m) => ({ type: m.type, message: m.message })),
  });
});

// Accepts audio blob, transcribes with Whisper, replies with GPT-4o, returns TTS audio
app.post("/api/v1/interview/:interviewId/turn", upload.single("audio"), async (req, res) => {
  const { interviewId } = req.params;

  const interview = await prisma.interview.findFirst({ where: { id: interviewId } });
  if (!interview) return res.status(404).json({ message: "Interview not found" });

  const isFirstTurn = interview.status === "Pre";
  const hasAudio = !!req.file && req.file.buffer.length > 2000;

  // Only allow empty-audio calls on the very first turn (AI greeting)
  // After that, require actual audio from the user
  if (!isFirstTurn && !hasAudio) {
    return res.status(400).json({ message: "No audio provided" });
  }

  // Mark in progress on first turn
  if (isFirstTurn) {
    await prisma.interview.update({ where: { id: interviewId }, data: { status: "InProgress" } });
  }

  const priorMessages = await prisma.message.findMany({
    where: { interviewId },
    orderBy: { createdAt: "asc" },
  });

  try {
    let userTranscript = "";

    // If audio was sent, convert to WAV and transcribe
    if (req.file && req.file.buffer.length > 2000) {
      try {
        const wavBuffer = await toWav(req.file.buffer);
        const audioFile = new File([wavBuffer], "audio.wav", { type: "audio/wav" });
        const transcription = await openai.audio.transcriptions.create({
          model: "whisper-1",
          file: audioFile,
          language: "en",
        });
        userTranscript = transcription.text.trim();
        console.log("Transcribed:", userTranscript);
      } catch (e) {
        console.error("Transcription error:", e);
      }
    }

    // Save user message
    if (userTranscript) {
      await prisma.message.create({
        data: { interviewId: interviewId!, type: "User", message: userTranscript },
      });
    }

    // Build GPT-4o conversation history
    const systemPrompt = `You are a warm, friendly senior technical interviewer conducting a spoken voice interview. You MUST respond in English only. Keep every response to 1-3 sentences maximum — this is a voice conversation.

Follow this exact flow:
1. GREETING: Start with a warm, natural greeting like "Hi! How are you doing today?" — nothing else. Wait for their response.
2. SMALL TALK: Respond naturally to whatever they say. Keep it brief and friendly (1-2 sentences). Then say you'll be conducting a technical interview based on their GitHub profile and ask if they're ready.
3. QUESTIONS: Once they confirm they're ready, ask ONE technical question at a time based on their background. Wait for their full answer before asking the next one. Ask 3 questions total.
4. WRAP UP: After they answer the 3rd question, say warmly: "Thank you for the interview, I have everything I need. It was great speaking with you!"

Rules:
- Never ask more than one question at a time.
- Never jump to technical questions before completing the greeting and small talk.
- Always wait for the candidate to finish before responding.
- Be warm, encouraging, and professional throughout.`;

    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...priorMessages.map((m) => ({
        role: (m.type === "Assistant" ? "assistant" : "user") as "assistant" | "user",
        content: m.message,
      })),
    ];

    if (userTranscript) {
      chatMessages.push({ role: "user", content: userTranscript });
    }

    // Get GPT-4o response
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatMessages,
    });

    const assistantText = completion.choices[0]!.message.content ?? "";

    // Save assistant message
    await prisma.message.create({
      data: { interviewId: interviewId!, type: "Assistant", message: assistantText },
    });

    // Convert to speech with TTS
    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "nova",
      input: assistantText,
      response_format: "mp3",
    });

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

    // Detect if interview should end
    const isEnd =
      assistantText.toLowerCase().includes("thank you for the interview") ||
      assistantText.toLowerCase().includes("i have everything i need") ||
      assistantText.toLowerCase().includes("it was great speaking with you") ||
      assistantText.toLowerCase().includes("that concludes");

    res.set("Content-Type", "audio/mpeg");
    res.set("X-Assistant-Text", encodeURIComponent(assistantText));
    res.set("X-User-Text", encodeURIComponent(userTranscript));
    res.set("X-Interview-End", isEnd ? "true" : "false");
    res.send(audioBuffer);
  } catch (error) {
    console.error("Turn error:", error);
    res.status(500).json({ error: "Failed to process turn" });
  }
});

app.post("/api/v1/result/:interviewId", async (req, res) => {
  const { interviewId } = req.params;

  const messages = await prisma.message.findMany({
    where: { interviewId },
    orderBy: { createdAt: "asc" },
  });

  if (!messages.length) {
    return res.status(404).json({ message: "No messages found for this interview" });
  }

  try {
    const result = await calculateResult(
      messages.map((m) => ({
        type: m.type as "Assistant" | "User",
        message: m.message,
        createdAt: m.createdAt,
      }))
    );

    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: "Done", score: Math.round(result.score), feedback: result.feedback },
    });

    return res.json(result);
  } catch (error) {
    console.error("Result Error:", error);
    return res.status(500).json({ error: "Failed to calculate result" });
  }
});

// GET result for polling
app.get("/api/v1/result/:interviewId", async (req, res) => {
  const { interviewId } = req.params;

  const interview = await prisma.interview.findFirst({ where: { id: interviewId } });
  if (!interview) return res.status(404).json({ message: "Not found" });

  const messages = await prisma.message.findMany({
    where: { interviewId },
    orderBy: { createdAt: "asc" },
  });

  return res.json({
    status: interview.status,
    score: interview.score ?? null,
    feedback: interview.feedback ?? null,
    transcript: messages.map((m) => ({
      type: m.type,
      content: m.message,
      createdAt: m.createdAt,
    })),
  });
});

app.listen(3001, () => {
  console.log("🚀 Server running on http://localhost:3001");
});
