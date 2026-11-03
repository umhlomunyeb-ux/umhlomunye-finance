import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { supabase } from "../../lib/supabase";
import { getSystemSettings } from "../../services/settingsService";

export default function MobileLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("Umhlomunye Finance");
  const [logo, setLogo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSystemSettings().then((settings) => {
      setCompanyName(settings?.company_name || "Umhlomunye Finance");
      setLogo(settings?.company_logo_url || "");
    }).catch((err) => console.error("Mobile branding:", err));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      navigate("/mobile/preview", { replace: true });
    } catch (err) {
      setError(err?.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "#f4f6f8", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
      <Card sx={{ width: "100%", maxWidth: 440, borderRadius: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack component="form" onSubmit={submit} spacing={2.5}>
            {logo ? <Box component="img" src={logo} alt={companyName} sx={{ maxWidth: 150, maxHeight: 76, objectFit: "contain", alignSelf: "center" }} /> : null}
            <Typography variant="h5" fontWeight={800} textAlign="center">{companyName}</Typography>
            <Typography color="text.secondary" textAlign="center">Sign in with your existing LMS account</Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth autoComplete="username" />
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth autoComplete="current-password" />
            <Button type="submit" variant="contained" size="large" disabled={loading || !email.trim() || !password} sx={{ minHeight: 52 }}>
              {loading ? <CircularProgress size={23} color="inherit" /> : "Sign In"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
