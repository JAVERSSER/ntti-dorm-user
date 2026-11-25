"use client";

import { RefreshCw } from "lucide-react";
import { Alert, buttonClass, Card } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-lg space-y-4">
      <Alert tone="error" title="Something went wrong">
        A temporary problem occurred. Please try again.
      </Alert>
      <button type="button" onClick={reset} className={buttonClass("primary", "w-full")}>
        <RefreshCw className="size-5" aria-hidden /> Try again
      </button>
    </Card>
  );
}
