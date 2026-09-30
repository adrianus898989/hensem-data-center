import DashboardAuthGate from "@/components/DashboardAuthGate";
import OfficialDashboard from "@/components/OfficialDashboard";

export default function Home() {
  return <DashboardAuthGate><OfficialDashboard /></DashboardAuthGate>;
}
