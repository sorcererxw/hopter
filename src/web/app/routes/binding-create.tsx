import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AddRepoDialog } from "@/components/orchd/add-repo-dialog";
import { ContentHeader } from "@/components/orchd/content-header";
import { EmptyState } from "@/components/orchd/empty-state";
import type { ProjectBindingView } from "@/lib/contracts";

export function BindingCreateRoute() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) {
      navigate("/", { replace: true });
    }
  }, [navigate, open]);

  return (
    <section className="mx-auto grid w-full max-w-4xl gap-4">
      <ContentHeader
        eyebrow="Add repo"
        title="Connect a repo context"
        description="Browse host directories inside a dialog. Every path is read from the server, so what you select is always a real host path."
      />
      <EmptyState
        title="Host-backed directory browser"
        description="This route now exists mostly to launch the dialog. The browser never reads local directories directly. The server does."
      />
      <AddRepoDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(binding: ProjectBindingView) => {
          setOpen(false);
          navigate(`/bindings/${binding.id}`, { replace: true });
        }}
      />
    </section>
  );
}
