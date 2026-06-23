import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, LogOut, Users, Circle, History, Check, CheckCheck, Lock, ArrowLeft } from "lucide-react";
import chatLogo from "@/assets/chat-logo.png";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
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
type ReadRow = { message_id: string; user_id: string; read_at: string };

const PRESENCE_INTERVAL = 25_000;
const TYPING_TTL = 4_000;

function ChatPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [typing, setTyping] = useState<TypingRow[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [showUsers, setShowUsers] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const myName = (user.user_metadata as { name?: string })?.name || user.email?.split("@")[0] || "User";

  // Initial load — only DMs that involve me
  useEffect(() => {
    (async () => {
      const [msgs, profs] = await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
          .order("created_at", { ascending: true })
          .limit(1000),
        supabase.from("profiles").select("*"),
      ]);
      if (msgs.data) {
        setMessages(msgs.data as Message[]);
        const ids = (msgs.data as Message[]).map((m) => m.id);
        if (ids.length) {
          const { data: rds } = await supabase.from("message_reads").select("*").in("message_id", ids);
          if (rds) setReads(rds as ReadRow[]);
        }
      }
      if (profs.data) {
        const map: Record<string, Profile> = {};
        for (const p of profs.data as Profile[]) map[p.id] = p;
        setProfiles(map);
      }
    })();
  }, [user.id]);

  // Realtime: messages (RLS already restricts to participants)
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

  useEffect(() => {
    const channel = supabase
      .channel("typing-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "typing_status" }, async () => {
        const { data } = await supabase.from("typing_status").select("*");
        if (data) setTyping(data as TypingRow[]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("reads-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reads" }, (payload) => {
        setReads((prev) => [...prev, payload.new as ReadRow]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Conversation with selected peer
  const conversation = useMemo(
    () =>
      peerId
        ? messages.filter(
            (m) =>
              (m.sender_id === user.id && m.recipient_id === peerId) ||
              (m.sender_id === peerId && m.recipient_id === user.id),
          )
        : [],
    [messages, peerId, user.id],
  );

  // Auto-scroll on new messages in the active conversation
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation.length]);

  // Mark incoming messages from peer as read
  useEffect(() => {
    if (!peerId) return;
    const unread = conversation.filter(
      (m) => m.sender_id === peerId && !reads.some((r) => r.message_id === m.id && r.user_id === user.id),
    );
    if (unread.length === 0) return;
    const rows = unread.map((m) => ({ message_id: m.id, user_id: user.id }));
    supabase.from("message_reads").upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true }).then();
  }, [conversation, reads, user.id, peerId]);

  // Presence heartbeat
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
    if (!trimmed || sending || !peerId) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("messages").insert({
      sender_id: user.id,
      sender_name: myName,
      recipient_id: peerId,
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

  const cutoff = Date.now() - 60_000;
  const allUsers = Object.values(profiles)
    .filter((p) => p.id !== user.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const onlineUsers = allUsers.filter((p) => p.status === "online" && new Date(p.last_seen).getTime() > cutoff);

  // Unread count per peer (messages from that peer to me, not yet read by me)
  const unreadByPeer = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of messages) {
      if (m.recipient_id !== user.id) continue;
      const alreadyRead = reads.some((r) => r.message_id === m.id && r.user_id === user.id);
      if (alreadyRead) continue;
      map.set(m.sender_id, (map.get(m.sender_id) ?? 0) + 1);
    }
    return map;
  }, [messages, reads, user.id]);

  const peer = peerId ? profiles[peerId] : null;
  const peerOnline = peer && peer.status === "online" && new Date(peer.last_seen).getTime() > cutoff;

  // Show "is typing" only when the peer is typing
  const peerTyping = peerId
    ? typing.find((t) => t.user_id === peerId && Date.now() - new Date(t.updated_at).getTime() < TYPING_TTL)
    : null;

  // Per-message reader counts (exclude sender)
  const readsByMsg = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of reads) {
      if (!m.has(r.message_id)) m.set(r.message_id, new Set());
      m.get(r.message_id)!.add(r.user_id);
    }
    return m;
  }, [reads]);

  function openPeer(id: string) {
    setPeerId(id);
    setShowUsers(false);
  }

  return (
    <div className="h-screen flex bg-background">
      <aside
        className={`${showUsers || !peerId ? "flex" : "hidden"} md:flex flex-col w-full md:w-72 border-r bg-card`}
      >
        <div className="p-4 border-b flex items-center gap-2">
          <img src={chatLogo} alt="" width={32} height={32} className="rounded-lg" />
          <div className="flex-1">
            <div className="font-semibold leading-tight">Pulse</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock size={10} /> End-to-end private DMs
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Members · {onlineUsers.length} online
          </div>
          {allUsers.length === 0 && (
            <div className="px-3 py-6 text-xs text-muted-foreground text-center">
              No other members yet. Invite someone to start chatting privately.
            </div>
          )}
          {allUsers.map((p) => {
            const online = p.status === "online" && new Date(p.last_seen).getTime() > cutoff;
            const unread = unreadByPeer.get(p.id) ?? 0;
            const active = p.id === peerId;
            return (
              <button
                key={p.id}
                onClick={() => openPeer(p.id)}
                className={`w-full text-left flex items-center gap-3 px-2 py-2 rounded-lg transition ${
                  active ? "bg-muted" : "hover:bg-muted"
                }`}
              >
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-brand-gradient flex items-center justify-center text-primary-foreground text-sm font-semibold">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  {online && (
                    <Circle className="absolute -bottom-0.5 -right-0.5 w-3 h-3 fill-online text-online stroke-card" strokeWidth={3} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{online ? "Online" : "Offline"}</div>
                </div>
                {unread > 0 && (
                  <span className="ml-1 text-[11px] font-semibold bg-primary text-primary-foreground rounded-full px-2 py-0.5 min-w-5 text-center">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="m-3 space-y-2">
          <Link
            to="/history"
            className="flex items-center justify-center gap-2 text-sm py-2 rounded-lg border hover:bg-muted transition"
          >
            <History size={16} /> Chat history
          </Link>
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 text-sm py-2 rounded-lg border hover:bg-muted transition"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className={`${peerId && !showUsers ? "flex" : "hidden"} md:flex flex-1 flex-col min-w-0`}>
        {!peer ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
            <div className="w-14 h-14 rounded-2xl bg-brand-gradient flex items-center justify-center mb-4">
              <Lock className="text-primary-foreground" size={24} />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Select a member to start a private chat</h2>
            <p className="text-sm mt-1 max-w-sm">
              Every conversation is one-to-one. Only you and the other person can see your messages.
            </p>
          </div>
        ) : (
          <>
            <header className="px-4 py-3 border-b flex items-center gap-3">
              <button
                onClick={() => setShowUsers(true)}
                className="md:hidden p-2 rounded-lg hover:bg-muted"
                aria-label="Back to members"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-brand-gradient flex items-center justify-center text-primary-foreground text-sm font-semibold">
                  {peer.name.charAt(0).toUpperCase()}
                </div>
                {peerOnline && (
                  <Circle className="absolute -bottom-0.5 -right-0.5 w-3 h-3 fill-online text-online stroke-card" strokeWidth={3} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-semibold truncate flex items-center gap-1.5">
                  {peer.name}
                  <Lock size={12} className="text-muted-foreground" />
                </h1>
                <p className="text-xs text-muted-foreground">{peerOnline ? "Online" : "Offline"} · Private chat</p>
              </div>
              <button
                onClick={() => setShowUsers((s) => !s)}
                className="hidden md:inline-flex p-2 rounded-lg hover:bg-muted"
                aria-label="Members"
              >
                <Users size={18} />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
              <div className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1 mb-4">
                <Lock size={11} /> Messages here are private between you and {peer.name}.
              </div>
              {conversation.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-12">
                  No messages yet. Say hi to {peer.name} 👋
                </div>
              )}
              {conversation.map((m, i) => {
                const mine = m.sender_id === user.id;
                const prev = conversation[i - 1];
                const showHeader = !prev || prev.sender_id !== m.sender_id;
                const readers = readsByMsg.get(m.id);
                const seenByPeer = readers ? Array.from(readers).some((u) => u !== m.sender_id) : false;
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
                      <div className="text-[10px] text-muted-foreground mt-1 px-2 flex items-center gap-1">
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        {mine && (
                          seenByPeer ? (
                            <span className="flex items-center gap-0.5 text-primary" title="Seen">
                              <CheckCheck size={12} /> Seen
                            </span>
                          ) : (
                            <Check size={12} className="opacity-60" />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {peerTyping && (
              <div className="px-6 pb-1 text-xs text-muted-foreground flex items-center gap-2">
                <span>{peer.name} is typing</span>
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
                placeholder={`Message ${peer.name}`}
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
          </>
        )}
      </main>
    </div>
  );
}
