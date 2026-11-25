import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-lg text-center">
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="mt-1 text-slate-600">The page you were looking for doesn&apos;t exist.</p>
      <Link href="/" className={buttonClass("primary", "mt-4")}>Go to payment form</Link>
    </Card>
  );
}
