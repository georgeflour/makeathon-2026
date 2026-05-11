import { ChatBox } from "@/components/ChatBox";

export default function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-24 px-4 sm:px-8">
      <div className="text-center max-w-3xl space-y-4 mb-16">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
          Hackathon Starter
        </h1>
        <p className="text-xl text-muted-foreground font-medium">
          UI + Azure AI Agent + Supabase Backend
        </p>
        <p className="text-muted-foreground max-w-xl mx-auto pt-4">
          Everything you need to kickstart your project. A clean Next.js frontend communicating with a scalable FastAPI backend, ready to be deployed.
        </p>
      </div>

      <div className="w-full">
        <ChatBox />
      </div>
    </div>
  );
}
