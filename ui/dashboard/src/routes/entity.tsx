/**
 * Entity route — entity impact profile page.
 */

import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { EntityProfile } from "@/components/EntityProfile.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function EntityPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return (
    <PageScroll>
    <div>
      <Link to="/" className="inline-block mb-4 no-underline">
        <Button variant="outline" size="sm">
          Back to Overview
        </Button>
      </Link>
      <EntityProfile entityId={id} />
    </div>
    </PageScroll>
  );
}
