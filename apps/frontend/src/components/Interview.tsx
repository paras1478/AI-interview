import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, Mic, Square, User } from "lucide-react";
import { VoiceOrb } from "./VoiceOrb";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const BACKEND_URL = "http://localhost:4000";

type Message = { type: "Assistant" | "User"; content: string };
type Phase = "idle" | "starting" | "listening" | "recording" | "thinking" | "speaking" | "done";

export function Interview() {
  const { interviewId } = useParams();
  const navigate = useNavigate();

  const [phase,     setPhase]     = useState<Phase>("idle");
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [aiLevel,   setAiLevel]   = useState(0);
  const [userLevel, setUserLevel] = useState(0);
  const [error,     setError]     = useState("");

  const phaseRef      = useRef<Phase>("idle");
  const recorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef     = useRef<Blob[]>([]);
  const animRef       = useRef(0);
  const meterCtxRef   = useRef<AudioContext | null>(null);
  const meterAnimRef  = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  function setPhaseSync(p: Phase) { phaseRef.current = p; setPhase(p); }

  // ── play AI audio ─────────────────────────────────────────────────────────
  async function playResponse(res: Response) {
    if (!res.ok) {
      const txt = await res.text();
      console.error("Turn error:", txt);
      setError("Error: " + txt);
      setPhaseSync("listening");
      return;
    }

    const assistantText = decodeURIComponent(res.headers.get("X-Assistant-Text") ?? "");
    const userText      = decodeURIComponent(res.headers.get("X-User-Text")      ?? "");
    const isEnd         = res.headers.get("X-Interview-End") === "true";

    console.log("User said:", userText);
    console.log("AI said:", assistantText);

    setMessages(prev => {
      const next = [...prev];
      if (userText)      next.push({ type: "User",      content: userText });
      if (assistantText) next.push({ type: "Assistant", content: assistantText });
      return next;
    });

    const blob  = await res.blob();
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    setPhaseSync("speaking");

    const ctx      = new AudioContext();
    const src      = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(ctx.destination);

    const tick = () => {
      if (phaseRef.current !== "speaking") return;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      setAiLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 128);
      animRef.current = requestAnimationFrame(tick);
    };

    audio.onplay  = tick;
    audio.onended = () => {
      cancelAnimationFrame(animRef.current);
      setAiLevel(0);
      ctx.close();
      URL.revokeObjectURL(url);
      if (isEnd) setPhaseSync("done");
      else       setPhaseSync("listening");
    };

    // play() here is safe because it's always triggered by a user gesture chain
    try {
      await audio.play();
    } catch (e) {
      console.error("Playback failed:", e);
      ctx.close();
      URL.revokeObjectURL(url);
      setPhaseSync("listening");
    }
  }

  // ── "Start Interview" button — user gesture unlocks audio ─────────────────
  async function handleStart() {
    setPhaseSync("starting");
    setError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/interview/${interviewId}/turn`, {
        method: "POST", body: new FormData(),
      });
      await playResponse(res);
    } catch {
      setError("Failed to connect. Check backend is running.");
      setPhaseSync("idle");
    }
  }

  // ── mic volume meter ──────────────────────────────────────────────────────
  function startMeter(stream: MediaStream) {
    const ctx      = new AudioContext();
    meterCtxRef.current = ctx;
    const src      = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const tick = () => {
      meterAnimRef.current = requestAnimationFrame(tick);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      setUserLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 128);
    };
    tick();
  }

  function stopMeter() {
    cancelAnimationFrame(meterAnimRef.current);
    meterCtxRef.current?.close();
    meterCtxRef.current = null;
    setUserLevel(0);
  }

  // ── start recording ───────────────────────────────────────────────────────
  async function startRecording() {
    if (phaseRef.current !== "listening") return;
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopMeter();
        stream.getTracks().forEach(t => t.stop());

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        console.log("Sending audio blob:", blob.size, "bytes", blob.type);

        if (blob.size < 1000) {
          setError("Recording too short, try again.");
          setPhaseSync("listening");
          return;
        }

        setPhaseSync("thinking");
        const form = new FormData();
        form.append("audio", blob, "audio.webm");

        try {
          const res = await fetch(`${BACKEND_URL}/api/v1/interview/${interviewId}/turn`, {
            method: "POST", body: form,
          });
          await playResponse(res);
        } catch {
          setError("Network error — please try again.");
          setPhaseSync("listening");
        }
      };

      recorder.start(100);
      startMeter(stream);
      setPhaseSync("recording");
    } catch (e: any) {
      setError("Mic error: " + e.message);
    }
  }

  // ── stop recording ────────────────────────────────────────────────────────
  function stopRecording() {
    if (phaseRef.current !== "recording") return;
    recorderRef.current?.stop();
  }

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const phaseLabel: Record<Phase, string> = {
    idle:      "Ready to start",
    starting:  "Connecting…",
    listening: "Your turn — press mic to speak",
    recording: "Recording… press stop when done",
    thinking:  "Thinking…",
    speaking:  "Interviewer speaking…",
    done:      "Interview complete",
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-background px-6 py-10 gap-6">
      <header className="w-full max-w-3xl">
        <h1 className="text-lg font-semibold tracking-tight">AI Interview</h1>
        <p className="text-sm text-muted-foreground">{phaseLabel[phase]}</p>
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </header>

      <div className="flex w-full max-w-3xl items-center justify-center gap-16">
        <VoiceOrb
          level={aiLevel}
          speaking={phase === "speaking"}
          label="Interviewer" sublabel="AI"
          icon={Bot} accent="violet"
        />
        <VoiceOrb
          level={phase === "recording" ? userLevel : 0}
          speaking={phase === "recording"}
          label="You" sublabel="Candidate"
          icon={User} accent="emerald"
        />
      </div>

      <div ref={transcriptRef} className="w-full max-w-3xl flex-1 overflow-y-auto py-2 max-h-64">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => {
            const isAi = m.type === "Assistant";
            return (
              <div key={i} className={cn("flex gap-3", isAi ? "justify-start" : "flex-row-reverse")}>
                <div className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-white",
                  isAi ? "bg-gradient-to-br from-violet-400 to-indigo-600"
                       : "bg-gradient-to-br from-emerald-300 to-teal-600"
                )}>
                  {isAi ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                </div>
                <div className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  isAi ? "rounded-tl-sm bg-card text-foreground"
                       : "rounded-tr-sm bg-primary text-primary-foreground"
                )}>
                  {m.content}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="flex w-full max-w-3xl flex-col items-center gap-3">
        {phase === "idle" && (
          <Button size="lg" onClick={handleStart} className="w-48">
            Start Interview
          </Button>
        )}

        {phase === "done" && (
          <Button size="lg" onClick={() => navigate(`/result/${interviewId}`)} className="w-48">
            View Results
          </Button>
        )}

        {(phase === "listening" || phase === "recording") && (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={phase === "recording" ? stopRecording : startRecording}
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all duration-200",
                phase === "recording"
                  ? "animate-pulse border-red-400 bg-red-500/20 text-red-400"
                  : "border-emerald-400 bg-emerald-500/10 text-emerald-400 hover:scale-105 hover:bg-emerald-500/20"
              )}
            >
              {phase === "recording"
                ? <Square className="size-6 fill-current" />
                : <Mic className="size-7" />}
            </button>
            <p className="text-xs text-muted-foreground">
              {phase === "recording" ? "Press to stop & send" : "Press to speak"}
            </p>
          </div>
        )}

        {(phase === "thinking" || phase === "speaking" || phase === "starting") && (
          <p className="text-xs text-muted-foreground animate-pulse">
            {phaseLabel[phase]}
          </p>
        )}
      </div>
    </main>
  );
}
