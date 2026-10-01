import DashboardAuthGate from "@/components/DashboardAuthGate";
import OfficialDashboard from "@/components/OfficialDashboard";
import DashboardEmbeddingGuard from "@/components/DashboardEmbeddingGuard";

export default function Home() {
  return <DashboardEmbeddingGuard><DashboardAuthGate><OfficialDashboard /></DashboardAuthGate></DashboardEmbeddingGuard>;
}
