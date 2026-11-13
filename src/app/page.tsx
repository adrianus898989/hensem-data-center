import DashboardAuthGate from "@/components/DashboardAuthGate";
import DeferredOfficialDashboard from "@/components/DeferredOfficialDashboard";
import DashboardEmbeddingGuard from "@/components/DashboardEmbeddingGuard";

export default function Home() {
  return <DashboardEmbeddingGuard><DashboardAuthGate><DeferredOfficialDashboard /></DashboardAuthGate></DashboardEmbeddingGuard>;
}
