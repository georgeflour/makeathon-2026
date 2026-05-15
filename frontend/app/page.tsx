import { ChatBox } from "@/components/ChatBox";

export default function Home() {
  return (
    <div className="flex-1 flex flex-col py-10 px-4 sm:px-8 max-w-4xl mx-auto w-full">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
          NR2Dashboard
        </h1>
        <p className="text-muted-foreground text-base max-w-xl mx-auto">
          Ask any question about SmartRep voicebot data — get a live chart instantly.
          No SQL required.
        </p>
      </div>
      <ChatBox />
    </div>
  );
}
