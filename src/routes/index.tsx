import { createFileRoute, Link } from "@tanstack/react-router";
import chatLogo from "@/assets/chat-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pulse — Real-time chat for your team" },
      { name: "description", content: "A modern, real-time chat app with presence, typing indicators, and instant messaging." },
      { property: "og:title", content: "Pulse — Real-time chat" },
      { property: "og:description", content: "Modern real-time messaging built on Lovable Cloud." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={chatLogo} alt="Pulse" width={36} height={36} className="rounded-lg" />
          <span className="font-semibold tracking-tight">Pulse</span>
        </div>
        <Link to="/auth" className="text-sm font-medium px-4 py-2 rounded-lg hover:bg-muted transition">Sign in</Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Conversations that feel <span className="bg-brand-gradient bg-clip-text text-transparent">instant</span>.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Real-time messaging, live presence, and typing indicators — built with a serverless backend you don't have to manage.
          </p>
          <div className="mt-8 flex gap-3 justify-center">
            <Link to="/auth" className="bg-brand-gradient text-primary-foreground px-6 py-3 rounded-xl font-medium shadow-glow hover:opacity-90 transition">
              Start chatting
            </Link>
          </div>
        </div>
      </main>
      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        Built on Lovable Cloud
      </footer>
    </div>
  );
}
