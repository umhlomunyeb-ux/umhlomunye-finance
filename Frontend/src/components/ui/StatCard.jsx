import { Card, CardContent, Typography } from "@mui/material";

export default function StatCard({ title, value }) {
  return (
    <Card sx={{ minWidth: 220 }}>
      <CardContent>
        <Typography
          variant="body2"
          color="text.secondary"
        >
          {title}
        </Typography>

        <Typography
          variant="h4"
          sx={{ mt: 1 }}
        >
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}