export default function StatCard({ title, value }) {

    return (

        <div
            style={{
                background: "white",
                padding: 25,
                borderRadius: 10,
                width: 260,
                boxShadow: "0 2px 8px rgba(0,0,0,.1)"
            }}
        >
            <h4>{title}</h4>

            <h2>{value}</h2>

        </div>

    );

}