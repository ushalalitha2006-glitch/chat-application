import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, LogOut, Users, Circle } from "lucide-react";
import chatLogo from "@/assets/chat-logo.png";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: string;
};

type Profile = {
  id: string;
  name: string;
  email: string;
  status: string;
  last_seen: string;
};

type TypingRow = { user_id: string; name: string; updated_at: string };

const PRESENCE_INTERVAL = 25_000;
const TYPING_TTL = 4_000;

function ChatPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [typing, setTyping] = useState<TypingRow[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const myName = (user.user_metadata as { name?: string })?.name || user.email?.split("@")[0] || "User";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Initial load
  useEffect(() => {
    (async () => {
      const [msgs, profs] = await Promise.all([
        supabase.from("messages").select("*").order("created_at", { ascending: true }).limit(200),
        supabase.from("profiles").select("*"),
      ]);
      if (msgs.data) setMessages(msgs.data as Message[]);
      if (profs.data) {
        const map: Record<string, Profile> = {};
        for (const p of profs.data as Profile[]) map[p.id] = p;
        setProfiles(map);
      }
    })();
  }, []);

  // Realtime: messages
  useEffect(() => {
    const channel = supabase
      .channel("messages-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        setMessages((prev) => [...prev, payload.new as Message]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        setMessages((prev) => prev.filter((m) => m.id !== (payload.old as Message).id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Realtime: profiles
  useEffect(() => {
    const channel = supabase
      .channel("profiles-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
        const row = (payload.new ?? payload.old) as Profile;
        setProfiles((prev) => ({ ...prev, [row.id]: { ...prev[row.id], ...(payload.new as Profile) } }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Realtime: typing
  useEffect(() => {
    const channel = supabase
      .channel("typing-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "typing_status" }, async () => {
        const { data } = await supabase.from("typing_status").select("*");
        if (data) setTyping(data as TypingRow[]);
      })
      .subscribe();
    supabase.from("typing_status").select("*").then(({ data }) => data && setTyping(data as TypingRow[]));
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Presence — heartbeat my online status & cleanup on unload
  useEffect(() => {
    const ping = () =>
      supabase.from("profiles").update({ status: "online", last_seen: new Date().toISOString() }).eq("id", user.id);
    ping();
    const id = setInterval(ping, PRESENCE_INTERVAL);
    const offline = () => {
      supabase.from("profiles").update({ status: "offline", last_seen: new Date().toISOString() }).eq("id", user.id);
      supabase.from("typing_status").delete().eq("user_id", user.id);
    };
    window.addEventListener("beforeunload", offline);
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", offline);
      offline();
    };
  }, [user.id]);

  const sendTyping = useCallback(async () => {
    await supabase.from("typing_status").upsert({ user_id: user.id, name: myName, updated_at: new Date().toISOString() });
  }, [user.id, myName]);

  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleInput(v: string) {
    setText(v);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    sendTyping();
    typingTimeout.current = setTimeout(() => {
      supabase.from("typing_status").delete().eq("user_id", user.id);
    }, TYPING_TTL);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("messages").insert({
      sender_id: user.id,
      sender_name: myName,
      text: trimmed,
    });
    if (error) {
      toast.error("Failed to send");
      setText(trimmed);
    }
    await supabase.from("typing_status").delete().eq("user_id", user.id);
    setSending(false);
  }

  async function signOut() {
    await supabase.from("profiles").update({ status: "offline", last_seen: new Date().toISOString() }).eq("id", user.id);
    await supabase.from("typing_status").delete().eq("user_id", user.id);
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  // Online = pinged in last 60s
  const cutoff = Date.now() - 60_000;
  const allUsers = Object.values(profiles).sort((a, b) => a.name.localeCompare(b.name));
  const onlineUsers = allUsers.filter((p) => p.status === "online" && new Date(p.last_seen).getTime() > cutoff);
  const typingNow = typing.filter(
    (t) => t.user_id !== user.id && Date.now() - new Date(t.updated_at).getTime() < TYPING_TTL,
  );

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <aside className={`${showUsers ? "flex" : "hidden"} md:flex flex-col w-72 border-r bg-card`}>
        <div className="p-4 border-b flex items-center gap-2">
          <img src={chatLogo} alt="" width={32} height={32} className="rounded-lg" />
          <div className="flex-1">
            <div className="font-semibold leading-tight">Pulse</div>
            <div className="text-xs text-muted-foreground">{onlineUsers.length} online</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Members</div>
          {allUsers.map((p) => {
            const online = p.status === "online" && new Date(p.last_seen).getTime() > cutoff;
            return (
              <div key={p.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-brand-gradient flex items-center justify-center text-primary-foreground text-sm font-semibold">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  {online && (
                    <Circle className="absolute -bottom-0.5 -right-0.5 w-3 h-3 fill-online text-online stroke-card" strokeWidth={3} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}{p.id === user.id && " (you)"}</div>
                  <div className="text-xs text-muted-foreground">{online ? "Online" : "Offline"}</div>
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={signOut}
          className="m-3 flex items-center justify-center gap-2 text-sm py-2 rounded-lg border hover:bg-muted transition"
        >
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b flex items-center gap-3">
          <button onClick={() => setShowUsers((s) => !s)} className="md:hidden p-2 rounded-lg hover:bg-muted">
            <Users size={18} />
          </button>
          <div className="flex-1">
            <h1 className="font-semibold">General</h1>
            <p className="text-xs text-muted-foreground">{onlineUsers.length} online · {allUsers.length} members</p>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-12">No messages yet. Say hi 👋</div>
          )}
          {messages.map((m, i) => {
            const mine = m.sender_id === user.id;
            const prev = messages[i - 1];
            const showHeader = !prev || prev.sender_id !== m.sender_id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  {showHeader && !mine && (
                    <div className="text-xs text-muted-foreground mb-1 ml-3">{m.sender_name}</div>
                  )}
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      mine
                        ? "bg-chat-user text-chat-user-foreground rounded-br-md"
                        : "bg-chat-other text-chat-other-foreground rounded-bl-md"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words text-sm">{m.text}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 px-2">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {typingNow.length > 0 && (
          <div className="px-6 pb-1 text-xs text-muted-foreground flex items-center gap-2">
            <span>{typingNow.map((t) => t.name).join(", ")} {typingNow.length === 1 ? "is" : "are"} typing</span>
            <span className="flex gap-0.5">
              <span className="typing-dot w-1 h-1 rounded-full bg-muted-foreground inline-block" />
              <span className="typing-dot w-1 h-1 rounded-full bg-muted-foreground inline-block" />
              <span className="typing-dot w-1 h-1 rounded-full bg-muted-foreground inline-block" />
            </span>
          </div>
        )}

        <form onSubmit={send} className="p-4 border-t flex gap-2">
          <input
            value={text}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Message #general"
            className="flex-1 px-4 py-2.5 rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-brand-gradient text-primary-foreground px-4 py-2.5 rounded-xl shadow-glow disabled:opacity-40 flex items-center gap-2 font-medium"
          >
            <Send size={16} />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </main>
    </div>
  );
}
