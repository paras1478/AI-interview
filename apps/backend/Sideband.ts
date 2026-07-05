import WebSocket from "ws";
import { prisma } from "./db";

export async function initSideband(sessionId: string, interviewId: string) {
    const url = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`;
    const ws = new WebSocket(url, {
        headers: {
            Authorization: "Bearer " + process.env.OPENAI_API_KEY,
            "OpenAI-Beta": "realtime=v1",
        },
    });

    const interview = await prisma.interview.findFirst({
        where: { id: interviewId },
    });

    ws.on("open", function open() {
        console.log("Sideband connected to OpenAI Realtime.");

        ws.send(
            JSON.stringify({
                type: "session.update",
                session: {
                    instructions: `You are supposed to interview this user on their computer science intellect. Ask around 2-3 questions based
                        on their experience. Please use english only during the interview.
                        Here is everything about the users github, will give you a rough idea about what the user does -
                        ## Github metadata
                        ${interview?.githubMetadata}
                    `,
                    modalities: ["text", "audio"],
                    voice: "alloy",
                    input_audio_transcription: { model: "whisper-1" },
                    turn_detection: { type: "server_vad" },
                },
            })
        );
    });

    ws.on("message", async function incoming(message) {
        const parsedMessage = JSON.parse(message.toString());

        if (parsedMessage.type === "response.done") {
            let contents: { type: string; transcript: string }[] = [];
            parsedMessage.response.output.map(
                (x: any) => (contents = [...contents, ...x.content])
            );
            const assistantMessage = contents
                .filter((x) => x.type === "audio")
                .map((x) => x.transcript)
                .join(" ");

            if (assistantMessage) {
                await prisma.message.create({
                    data: {
                        interviewId,
                        type: "Assistant",
                        message: assistantMessage,
                    },
                });
            }
        }

        if (parsedMessage.type === "conversation.item.input_audio_transcription.completed") {
            const userMessage = parsedMessage.transcript;
            if (userMessage) {
                await prisma.message.create({
                    data: {
                        interviewId,
                        type: "User",
                        message: userMessage,
                    },
                });
            }
        }
    });

    ws.on("error", (err) => console.error("Sideband WS error:", err));
    ws.on("close", () => console.log("Sideband WS closed for session:", sessionId));
}
