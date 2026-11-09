import AdminDashboard from "@/components/admin/dashboard";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ section?: string; visibility?: string }> }) {
  const query = await searchParams;
  const section = query.section === "categories" ? "categories" : "products";
  const visibility = ["all", "visible", "hidden", "review", "archived"].includes(query.visibility ?? "") ? query.visibility! : "all";
  return <AdminDashboard key={section + visibility} initialSection={section} initialVisibility={visibility} />;
}
