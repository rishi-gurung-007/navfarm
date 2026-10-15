import { redirect } from "next/navigation";

export default function ExpensesIndex() {
  redirect("/expenses/expense");
}
