export default function Header() {

    return (

        <div
            style={{
                height: 70,
                background: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 30px",
                boxShadow: "0 2px 6px rgba(0,0,0,.1)"
            }}
        >
            <h2>Dashboard</h2>

            <strong>Administrator</strong>

        </div>

    );

}