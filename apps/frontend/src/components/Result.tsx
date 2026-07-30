import { BACKEND_URL } from "@/lib/config";
import { withRetry } from "@/lib/retry";
import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, CheckCircle2, Circle, Loader2, Sparkles, ThumbsDown, ThumbsUp, User, XCircle } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

type Verdict = "correct" | "partial" | "incorrect";

interface QuestionFeedback {
    question: string;
    answer: string;
    verdict: Verdict;
    suggestion: string;
}

interface ResultData {
    transcript: { type: "Assistant" | "User"; content: string; createdAt: string }[];
    score: number;
    feedback: string;
    strengths: string[];
    weaknesses: string[];
    questions: QuestionFeedback[];
    status: "Done" | "InProgress" | "Pre";
}

const verdictConfig: Record<Verdict, { label: string; icon: typeof CheckCircle2; className: string }> = {
    correct: { label: "Correct", icon: CheckCircle2, className: "text-emerald-500 bg-emerald-500/10" },
    partial: { label: "Partially correct", icon: Circle, className: "text-amber-500 bg-amber-500/10" },
    incorrect: { label: "Incorrect", icon: XCircle, className: "text-red-500 bg-red-500/10" },
};

export function Result() {
    const { interviewId } = useParams();
    const navigate = useNavigate();
    const [result, setResult] = useState<ResultData>({
        score: 0,
        feedback: "",
        strengths: [],
        weaknesses: [],
        questions: [],
        transcript: [],
        status: "Pre",
    });

    useEffect(() => {
        const fetchResult = () =>
            withRetry(() => axios.get(`${BACKEND_URL}/api/v1/result/${interviewId}`)).then((response) => {
                setResult(response.data);
                return response.data.status as ResultData["status"];
            });

        fetchResult();
        const intervalId = setInterval(async () => {
            const s = await fetchResult();
            if (s === "Done") clearInterval(intervalId);
        }, 5000);

        return () => clearInterval(intervalId);
    }, [interviewId]);

    const ready = result.status === "Done";

    return (
        <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
            <header className="mb-10 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Interview results</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Your feedback and full conversation transcript.
                    </p>
                </div>
                <Button variant="outline" onClick={() => navigate("/")}>
                    New interview
                </Button>
            </header>

            {!ready ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card/50 py-24 text-center">
                    <Loader2 className="size-7 animate-spin text-muted-foreground" />
                    <div>
                        <p className="font-medium">Analyzing your interview…</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            This usually takes a few seconds.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {/* Score + feedback */}
                    <section className="rounded-xl border border-border bg-card/60 p-6 backdrop-blur">
                        <div className="flex items-start justify-between gap-6">
                            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                <Sparkles className="size-4 text-violet-400" />
                                AI Feedback
                            </div>
                            <div className="flex shrink-0 items-baseline gap-1">
                                <span className="text-3xl font-bold tracking-tight">
                                    {result.score}
                                </span>
                                <span className="text-sm text-muted-foreground">/ 10</span>
                            </div>
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                            {result.feedback}
                        </p>
                    </section>

                    {/* Strengths & weaknesses */}
                    {(result.strengths.length > 0 || result.weaknesses.length > 0) && (
                        <section className="grid gap-4 sm:grid-cols-2">
                            <div className="rounded-xl border border-border bg-card/60 p-5">
                                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-500">
                                    <ThumbsUp className="size-4" />
                                    Strengths
                                </div>
                                <ul className="flex flex-col gap-2">
                                    {result.strengths.map((s, i) => (
                                        <li key={i} className="text-sm leading-relaxed text-foreground/90">
                                            • {s}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="rounded-xl border border-border bg-card/60 p-5">
                                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-500">
                                    <ThumbsDown className="size-4" />
                                    Weaknesses
                                </div>
                                <ul className="flex flex-col gap-2">
                                    {result.weaknesses.map((w, i) => (
                                        <li key={i} className="text-sm leading-relaxed text-foreground/90">
                                            • {w}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </section>
                    )}

                    {/* Per-question breakdown */}
                    {result.questions.length > 0 && (
                        <section>
                            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                                Question-by-question feedback
                            </h2>
                            <div className="flex flex-col gap-4">
                                {result.questions.map((q, i) => {
                                    const v = verdictConfig[q.verdict];
                                    const VIcon = v.icon;
                                    return (
                                        <div key={i} className="rounded-xl border border-border bg-card/60 p-5">
                                            <div className="flex items-start justify-between gap-4">
                                                <p className="text-sm font-medium text-foreground/90">
                                                    Q{i + 1}. {q.question}
                                                </p>
                                                <span
                                                    className={cn(
                                                        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                                                        v.className,
                                                    )}
                                                >
                                                    <VIcon className="size-3.5" />
                                                    {v.label}
                                                </span>
                                            </div>
                                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                                <span className="font-medium text-foreground/70">Your answer: </span>
                                                {q.answer || "No answer given."}
                                            </p>
                                            <p className="mt-3 text-sm leading-relaxed text-foreground/90">
                                                <span className="font-medium text-violet-400">Suggestion: </span>
                                                {q.suggestion}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {/* Transcript */}
                    <section>
                        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                            Conversation
                        </h2>
                        <div className="flex flex-col gap-4">
                            {result.transcript.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No messages were recorded for this interview.
                                </p>
                            )}
                            {result.transcript.map((m, i) => {
                                const isAi = m.type === "Assistant";
                                return (
                                    <div
                                        key={i}
                                        className={cn(
                                            "flex gap-3",
                                            isAi ? "justify-start" : "flex-row-reverse",
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "grid size-8 shrink-0 place-items-center rounded-full text-white",
                                                isAi
                                                    ? "bg-gradient-to-br from-violet-400 to-indigo-600"
                                                    : "bg-gradient-to-br from-emerald-300 to-teal-600",
                                            )}
                                        >
                                            {isAi ? (
                                                <Bot className="size-4" />
                                            ) : (
                                                <User className="size-4" />
                                            )}
                                        </div>
                                        <div
                                            className={cn(
                                                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                                                isAi
                                                    ? "rounded-tl-sm bg-card text-foreground"
                                                    : "rounded-tr-sm bg-primary text-primary-foreground",
                                            )}
                                        >
                                            {m.content}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}
