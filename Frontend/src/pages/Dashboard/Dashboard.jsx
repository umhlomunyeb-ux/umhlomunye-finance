import StatCard from "../../components/dashboard/StatCard";

export default function Dashboard() {
  return (
    <>
      <h2>Dashboard</h2>

      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <StatCard title="Total Customers" value="0" />
        <StatCard title="Active Loans" value="0" />
        <StatCard title="Outstanding Balance" value="R0" />
        <StatCard title="Today's Collections" value="R0" />
      </div>
    </>
  );
}