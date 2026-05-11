export function Footer() {
  return (
    <footer className="w-full border-t bg-background py-6 mt-12">
      <div className="container mx-auto flex flex-col items-center justify-center gap-4 px-4 sm:px-8 md:flex-row md:justify-between text-center md:text-left">
        <p className="text-sm text-muted-foreground">
          Built for the Hackathon. Powered by Next.js, FastAPI & Azure AI.
        </p>
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} StarterApp. No rights reserved.
        </p>
      </div>
    </footer>
  );
}
