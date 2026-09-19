import { redirect } from "next/navigation";

/**
 * The ledger is the home screen. Someone opening this app is either recording
 * a bill or checking what is owed, and the ledger is one tap from both.
 */
export default function Home() {
  redirect("/ledger");
}
