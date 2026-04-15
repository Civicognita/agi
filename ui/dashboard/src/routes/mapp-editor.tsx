/**
 * MApp Editor route — /magic-apps/editor/:id?
 * No id = create new. With id = edit existing.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { MAppEditor } from "@/components/MAppEditor.js";
import { PageScroll } from "@/components/PageScroll.js";
import { fetchMagicApp } from "@/api.js";

export default function MAppEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [initialDef, setInitialDef] = useState<Record<string, unknown> | undefined>(undefined);
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    if (!id) return;
    fetchMagicApp(id)
      .then((app) => setInitialDef(app as unknown as Record<string, unknown>))
      .catch(() => setInitialDef(undefined))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = useCallback(async (definition: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/mapps/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition, approved: true }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(`Save failed: ${err.error ?? "Unknown error"}`);
        return;
      }
      navigate("/magic-apps/admin");
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [navigate]);

  if (loading) return <PageScroll><div className="text-muted-foreground">Loading...</div></PageScroll>;

  return (
    <PageScroll>
    <MAppEditor
      initialDefinition={initialDef}
      onSave={(def) => void handleSave(def)}
      onClose={() => navigate("/magic-apps/admin")}
    />
    </PageScroll>
  );
}
