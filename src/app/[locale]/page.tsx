import { redirect } from "next/navigation";

// The open-source build has no marketing site: the root goes straight to the app.
export default function Home() {
  redirect("/dashboard");
}
