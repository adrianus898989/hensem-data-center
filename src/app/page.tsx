import DashboardAuthGate from "@/components/DashboardAuthGate";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  return <DashboardAuthGate><Dashboard /></DashboardAuthGate>;
}
