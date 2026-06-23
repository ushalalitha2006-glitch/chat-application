import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Search, CheckCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  text: string;
  created_at: string;
};
type Profile = { id: string; name: string };
type ReadRow = { message_id: string; user_id: string };

function HistoryPage() {
  const { user } = Route.useRouteContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // RLS restricts results to messages where the current user is sender or recipient
      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      const list = (msgs ?? []) as Message[];
      setMessages(list);
      const ids = list.map((m) => m.id);
      const [rds, profs] = await Promise.all([
        ids.length
          ? supabase.from("message_reads").select("message_id,user_id").in("message_id", ids)
          : Promise.resolve({ data: [] as ReadRow[] }),
        supabase.from("profiles").select("id,name"),
      ]);
      if (rds.data) setReads(rds.data as ReadRow[]);
      if (profs.data) {
        const map: Record<string, Profile> = {};
        for (const p of profs.data as Profile[]) map[p.id] = p;
        setProfiles(map);
      }
      setLoading(false);
    })();
  }, []);

  const readsByMsg = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of reads) {
      if (!m.has(r.message_id)) m.set(r.message_id, new Set());
      m.get(r.message_id)!.add(r.user_id);
    }
    return m;
  }, [reads]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter((m) => {
      const peerId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
      const peerName = profiles[peerId]?.name ?? "";
      return (
        m.text.toLowerCase().includes(term) ||
        m.sender_name.toLowerCase().includes(term) ||
        peerName.toLowerCase().includes(term)
      );
    });
  }, [messages, q, profiles, user.id]);

  // Group by date label
  const groups = useMemo(() => {
    const map = new Map<string, Message[]>();
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    for (const m of filtered) {
      const key = fmt(new Date(m.created_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/chat" className="p-2 rounded-lg hover:bg-muted" aria-label="Back">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1">
            <h1 className="font-semibold">Chat history</h1>
            <p className="text-xs text-muted-foreground">{messages.length} messages</p>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search messages or sender..."
              className="w-full pl-9 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center text-muted-foreground py-12 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted-foreground py-12 text-sm">No messages found.</div>
        ) : (
          <div className="space-y-8">
            {groups.map(([day, items]) => (
              <section key={day}>
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2 px-1">{day}</h2>
                <div className="rounded-xl border bg-card divide-y">
                  {items.map((m) => {
                    const mine = m.sender_id === user.id;
                    const peerId = mine ? m.recipient_id : m.sender_id;
                    const peerName = profiles[peerId]?.name ?? "Unknown";
                    const readers = readsByMsg.get(m.id);
                    const seenByPeer = readers ? Array.from(readers).some((u) => u !== m.sender_id) : false;
                    return (
                      <div key={m.id} className="p-3 flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-gradient flex items-center justify-center text-primary-foreground text-sm font-semibold shrink-0">
                          {m.sender_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-medium text-sm">{m.sender_name}{mine && " (you)"}</span>
                            <span className="text-[11px] text-muted-foreground">→ {mine ? peerName : "you"}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {mine && seenByPeer && (
                              <span className="text-[11px] text-primary flex items-center gap-0.5">
                                <CheckCheck size={11} /> Seen
                              </span>
                            )}
                          </div>
                          <div className="text-sm whitespace-pre-wrap break-words mt-0.5">{m.text}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
