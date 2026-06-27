/**
 * Memory — browse Aion's memory (Wave 4). Owner: "I need a way to browse Aion's
 * memories… shared across the whole app. Aion is one mind." A top-level page over
 * the existing global memory APIs (/api/memory/events + /api/memory/search-docs),
 * deliberately framed as ONE shared memory, not per-channel.
 */
import { useState, useEffect, useCallback } from "react";
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import { fetchMemoryEvents, searchMemoryDocs, type MemoryEvent, type MemoryDocChunk } from "@/api.js";

function EventsTab() {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await fetchMemoryEvents({ q: q.trim() || undefined, projectPath: project.trim() || undefined, limit: 100 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load memories");
    } finally {
      setLoading(false);
    }
  }, [q, project]);

  useEffect(() => { void load(); /* initial */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Input
          className="flex-1 min-w-[200px]"
          placeholder="Search memories (semantic)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="memory-search"
        />
        <Input className="w-48" placeholder="Filter by project path" value={project} onChange={(e) => setProject(e.target.value)} />
        <Button size="sm" onClick={() => void load()} disabled={loading} data-testid="memory-search-btn">
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>
      {error !== null && <p className="text-[12px] text-red">{error}</p>}
      {!loading && events.length === 0 ? (
        <Card className="p-4" data-testid="memory-empty">
          <p className="text-sm text-muted-foreground italic">
            No memories match yet. As Aion works across chats, channels, and projects, episodic memories land
            here — one shared mind.
          </p>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="memory-events">
          {events.map((ev) => (
            <Card key={ev.id} className="p-3" data-testid="memory-event-row">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{ev.summary}</p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    {ev.tags.map((t) => (
                      <Badge key={t} className="bg-blue-500/15 text-blue-400">{t}</Badge>
                    ))}
                    {ev.projectPath !== null && (
                      <span className="text-[10px] font-mono text-muted-foreground/70">{ev.projectPath}</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground/60">conf {Math.round(ev.confidence * 100)}%</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DocsTab() {
  const [q, setQ] = useState("");
  const [chunks, setChunks] = useState<MemoryDocChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    if (q.trim() === "") return;
    setLoading(true);
    setSearched(true);
    try {
      setChunks(await searchMemoryDocs(q.trim(), undefined, 20));
    } catch {
      setChunks([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          className="flex-1"
          placeholder="Search Aion's knowledge docs (PRIME, agi docs, project knowledge)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="memory-docs-search"
        />
        <Button size="sm" onClick={() => void search()} disabled={loading || q.trim() === ""}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>
      {chunks.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground italic">
            {searched ? "No matching doc chunks." : "Search the hardened knowledge tier — PRIME corpus, agi docs, and per-project knowledge."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="memory-docs">
          {chunks.map((c, i) => (
            <Card key={`${c.sourcePath}-${String(i)}`} className="p-3">
              {c.heading !== null && <p className="text-[12px] font-semibold text-foreground">{c.heading}</p>}
              <p className="text-[12px] text-muted-foreground whitespace-pre-wrap line-clamp-4">{c.content}</p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">{c.sourcePath} · {c.scope}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MemoryPage() {
  return (
    <PageScroll>
      <div className="max-w-[1000px] w-full mx-auto p-4 md:p-6 space-y-4" data-testid="memory-page">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Aion's Mind</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            One shared memory across the whole app — not per-channel. Everything Aion learns in chats, channels,
            and projects lands here.
          </p>
        </div>
        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events" data-testid="memory-tab-events">Memories</TabsTrigger>
            <TabsTrigger value="docs" data-testid="memory-tab-docs">Knowledge docs</TabsTrigger>
          </TabsList>
          <TabsContent value="events"><div className="pt-3"><EventsTab /></div></TabsContent>
          <TabsContent value="docs"><div className="pt-3"><DocsTab /></div></TabsContent>
        </Tabs>
      </div>
    </PageScroll>
  );
}
