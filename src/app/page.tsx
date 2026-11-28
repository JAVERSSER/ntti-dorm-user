import { connection } from "next/server";
import { Alert } from "@/components/ui";
import { getFormOptions, type FormOptions } from "@/lib/form-data";
import { PaymentForm } from "./payment-form";

export default async function HomePage() {
  await connection(); // always read the latest rooms / schools / fee

  let options: FormOptions;
  try {
    options = await getFormOptions();
  } catch (error) {
    console.error("[home] options", (error as Error).message);
    return (
      <Alert tone="error" title="The form is temporarily unavailable">
        Please try again in a few minutes or contact the dormitory office.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Pay dormitory fee</h1>
        <p className="mt-1.5 text-slate-600">Fill in your details, then scan your QR to pay. Your payment is confirmed automatically.</p>
      </header>
      <PaymentForm {...options} />
    </div>
  );
}
