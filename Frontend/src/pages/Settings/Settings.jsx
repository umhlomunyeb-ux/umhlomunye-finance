import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";

import SaveIcon from "@mui/icons-material/Save";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RefreshIcon from "@mui/icons-material/Refresh";

import toast from "react-hot-toast";

import {
  DEFAULT_SETTINGS,
  getSystemSettings,
  updateSystemSettings,
} from "../../services/settingsService";

import {
  getCurrentUserProfile,
  isCurrentUserAdmin,
  getUsers,
  createUser,
} from "../../services/userService";

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [users, setUsers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  const [error, setError] = useState("");

  const [userDialogOpen, setUserDialogOpen] = useState(false);

  const [newUser, setNewUser] = useState({
    username: "",
    full_name: "",
    email: "",
    cellphone: "",
    password: "",
    role: "user",
  });

  useEffect(() => {
    loadPage();
  }, []);

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const [settingsData, currentProfile, adminStatus] =
        await Promise.all([
          getSystemSettings(),
          getCurrentUserProfile(),
          isCurrentUserAdmin(),
        ]);

      setSettings({
        ...DEFAULT_SETTINGS,
        ...settingsData,
      });

      setProfile(currentProfile);
      setIsAdmin(Boolean(adminStatus));

      if (adminStatus) {
        await loadUsers();
      }
    } catch (err) {
      console.error("Settings load error:", err);
      setError(
        err.message || "Unable to load settings."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      setLoadingUsers(true);

      const data = await getUsers();

      setUsers(data || []);
    } catch (err) {
      console.error("Users load error:", err);
      toast.error(
        err.message || "Unable to load users."
      );
    } finally {
      setLoadingUsers(false);
    }
  }

  function handleChange(field, value) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validateSettings() {
    const minimum = Number(settings.minimum_loan_amount);
    const maximum = Number(settings.maximum_loan_amount);
    const tier1Max = Number(settings.tier_1_max_amount);
    const tier1Rate = Number(settings.tier_1_interest_rate);
    const tier2Rate = Number(settings.tier_2_interest_rate);
    const maxTerm = Number(settings.maximum_loan_term_months);
    const cycleDays = Number(settings.interest_cycle_days);

    if (minimum <= 0) {
      return "Minimum loan amount must be greater than zero.";
    }

    if (maximum <= minimum) {
      return "Maximum loan amount must be greater than minimum loan amount.";
    }

    if (tier1Max < minimum || tier1Max > maximum) {
      return "Tier 1 maximum must be between the minimum and maximum loan amounts.";
    }

    if (tier1Rate < 0 || tier1Rate > 100) {
      return "Tier 1 interest rate must be between 0% and 100%.";
    }

    if (tier2Rate < 0 || tier2Rate > 100) {
      return "Tier 2 interest rate must be between 0% and 100%.";
    }

    if (maxTerm <= 0) {
      return "Maximum loan term must be greater than zero.";
    }

    if (cycleDays <= 0) {
      return "Interest cycle must be greater than zero days.";
    }

    return null;
  }

  async function handleSave() {
    if (!isAdmin) {
      toast.error("Only administrators can change settings.");
      return;
    }

    try {
      setError("");

      const validationError = validateSettings();

      if (validationError) {
        setError(validationError);
        return;
      }

      setSaving(true);

      const saved = await updateSystemSettings(settings);

      setSettings({
        ...DEFAULT_SETTINGS,
        ...saved,
      });

      toast.success("Loan rules saved successfully.");
    } catch (err) {
      console.error("Save settings error:", err);

      setError(
        err.message || "Unable to save settings."
      );

      toast.error("Unable to save loan rules.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!isAdmin) {
      toast.error("Only administrators can restore settings.");
      return;
    }

    setSettings({
      ...DEFAULT_SETTINGS,
    });

    setError("");

    toast.success(
      "Default rules restored. Click Save to apply them."
    );
  }

  function handleUserChange(field, value) {
    setNewUser((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function closeUserDialog() {
    if (creatingUser) return;

    setUserDialogOpen(false);

    setNewUser({
      username: "",
      full_name: "",
      email: "",
      cellphone: "",
      password: "",
      role: "user",
    });
  }

  async function handleCreateUser() {
    if (!isAdmin) {
      toast.error("Only administrators can create users.");
      return;
    }

    if (!newUser.username.trim()) {
      toast.error("Enter a username.");
      return;
    }

    if (!newUser.full_name.trim()) {
      toast.error("Enter the user's full name.");
      return;
    }

    if (!newUser.email.trim()) {
      toast.error("Enter the user's email.");
      return;
    }

    if (!newUser.password || newUser.password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    try {
      setCreatingUser(true);

      await createUser({
        username: newUser.username.trim(),
        full_name: newUser.full_name.trim(),
        email: newUser.email.trim(),
        cellphone: newUser.cellphone.trim(),
        password: newUser.password,
        role: newUser.role,
      });

      toast.success("User created successfully.");

      closeUserDialog();

      await loadUsers();
    } catch (err) {
      console.error("Create user error:", err);

      toast.error(
        err.message || "Unable to create user."
      );
    } finally {
      setCreatingUser(false);
    }
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>
          Settings
        </Typography>

        <Typography color="text.secondary">
          Manage Umhlomunye Finance system and loan rules.
        </Typography>

        {profile && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            Signed in as:{" "}
            <strong>
              {profile.full_name || profile.username}
            </strong>
          </Typography>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!isAdmin && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          You can view system settings, but only an active
          administrator can change loan rules or manage users.
        </Alert>
      )}

      {/* COMPANY SETTINGS */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700}>
            Company Settings
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Basic company information.
          </Typography>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Company Name"
                value={settings.company_name}
                onChange={(e) =>
                  handleChange(
                    "company_name",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label="Currency"
                value={settings.currency}
                onChange={(e) =>
                  handleChange(
                    "currency",
                    e.target.value.toUpperCase()
                  )
                }
                disabled={!isAdmin}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label="Timezone"
                value={settings.timezone}
                onChange={(e) =>
                  handleChange(
                    "timezone",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* LOAN RULES */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700}>
            Loan Rules
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            These rules determine the pricing of new loans.
          </Typography>

          <Alert severity="info" sx={{ mb: 3 }}>
            Current default pricing is R100–R2,000 at 40%
            interest and above R2,000 at 30% interest.
            Existing loans retain their stored interest rate.
          </Alert>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Minimum Loan Amount"
                value={settings.minimum_loan_amount}
                onChange={(e) =>
                  handleChange(
                    "minimum_loan_amount",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  startAdornment: (
                    <Typography sx={{ mr: 1 }}>
                      R
                    </Typography>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Maximum Loan Amount"
                value={settings.maximum_loan_amount}
                onChange={(e) =>
                  handleChange(
                    "maximum_loan_amount",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  startAdornment: (
                    <Typography sx={{ mr: 1 }}>
                      R
                    </Typography>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />

              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Interest Tier 1
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                Loans up to this amount use the Tier 1
                interest rate.
              </Typography>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Tier 1 Maximum Amount"
                value={settings.tier_1_max_amount}
                onChange={(e) =>
                  handleChange(
                    "tier_1_max_amount",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  startAdornment: (
                    <Typography sx={{ mr: 1 }}>
                      R
                    </Typography>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Tier 1 Interest Rate"
                value={settings.tier_1_interest_rate}
                onChange={(e) =>
                  handleChange(
                    "tier_1_interest_rate",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: (
                    <Typography sx={{ ml: 1 }}>
                      %
                    </Typography>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />

              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Interest Tier 2
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                Loans above the Tier 1 maximum use this
                interest rate.
              </Typography>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Tier 2 Interest Rate"
                value={settings.tier_2_interest_rate}
                onChange={(e) =>
                  handleChange(
                    "tier_2_interest_rate",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: (
                    <Typography sx={{ ml: 1 }}>
                      %
                    </Typography>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />

              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Loan Terms
              </Typography>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Maximum Loan Term"
                value={settings.maximum_loan_term_months}
                onChange={(e) =>
                  handleChange(
                    "maximum_loan_term_months",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: (
                    <Typography sx={{ ml: 1 }}>
                      months
                    </Typography>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Interest Cycle"
                value={settings.interest_cycle_days}
                onChange={(e) =>
                  handleChange(
                    "interest_cycle_days",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: (
                    <Typography sx={{ ml: 1 }}>
                      days
                    </Typography>
                  ),
                }}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          <Typography
            variant="subtitle1"
            fontWeight={700}
          >
            Current Pricing Preview
          </Typography>

          <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography>
              R{Number(settings.minimum_loan_amount).toLocaleString()}
              {" – "}
              R{Number(settings.tier_1_max_amount).toLocaleString()}
              {" → "}
              <strong>
                {settings.tier_1_interest_rate}%
              </strong>
            </Typography>

            <Typography>
              Above R
              {Number(settings.tier_1_max_amount).toLocaleString()}
              {" → "}
              <strong>
                {settings.tier_2_interest_rate}%
              </strong>
            </Typography>

            <Typography>
              Maximum loan:{" "}
              <strong>
                R
                {Number(settings.maximum_loan_amount).toLocaleString()}
              </strong>
            </Typography>

            <Typography>
              Maximum term:{" "}
              <strong>
                {settings.maximum_loan_term_months} months
              </strong>
            </Typography>

            <Typography>
              Interest cycle:{" "}
              <strong>
                {settings.interest_cycle_days} days
              </strong>
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      {/* SETTINGS ACTIONS */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
          >
            <Button
              variant="contained"
              size="large"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={!isAdmin || saving}
            >
              {saving ? "Saving..." : "Save Loan Rules"}
            </Button>

            <Button
              variant="outlined"
              size="large"
              startIcon={<RestartAltIcon />}
              onClick={handleReset}
              disabled={!isAdmin || saving}
            >
              Restore Defaults
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* USER MANAGEMENT */}
      {isAdmin && (
        <Card>
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={2}
              sx={{ mb: 3 }}
            >
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  User Management
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Create and manage system users.
                </Typography>
              </Box>

              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadUsers}
                  disabled={loadingUsers}
                >
                  Refresh
                </Button>

                <Button
                  variant="contained"
                  startIcon={<PersonAddIcon />}
                  onClick={() => setUserDialogOpen(true)}
                >
                  Create User
                </Button>
              </Stack>
            </Stack>

            {loadingUsers ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  py: 4,
                }}
              >
                <CircularProgress />
              </Box>
            ) : users.length === 0 ? (
              <Alert severity="info">
                No users found.
              </Alert>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Username</TableCell>
                      <TableCell>Full Name</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          {user.username || "-"}
                        </TableCell>

                        <TableCell>
                          {user.full_name || "-"}
                        </TableCell>

                        <TableCell>
                          {user.email || "-"}
                        </TableCell>

                        <TableCell>
                          <Chip
                            label={
                              user.role === "admin"
                                ? "Administrator"
                                : "User"
                            }
                            color={
                              user.role === "admin"
                                ? "primary"
                                : "default"
                            }
                            size="small"
                          />
                        </TableCell>

                        <TableCell>
                          <Chip
                            label={
                              user.is_active
                                ? "Active"
                                : "Inactive"
                            }
                            color={
                              user.is_active
                                ? "success"
                                : "default"
                            }
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* CREATE USER DIALOG */}
      <Dialog
        open={userDialogOpen}
        onClose={closeUserDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create System User</DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Username"
              value={newUser.username}
              onChange={(e) =>
                handleUserChange(
                  "username",
                  e.target.value
                )
              }
            />

            <TextField
              fullWidth
              label="Full Name"
              value={newUser.full_name}
              onChange={(e) =>
                handleUserChange(
                  "full_name",
                  e.target.value
                )
              }
            />

            <TextField
              fullWidth
              type="email"
              label="Email"
              value={newUser.email}
              onChange={(e) =>
                handleUserChange(
                  "email",
                  e.target.value
                )
              }
            />

            <TextField
              fullWidth
              label="Cellphone"
              value={newUser.cellphone}
              onChange={(e) =>
                handleUserChange(
                  "cellphone",
                  e.target.value
                )
              }
            />

            <TextField
              fullWidth
              type="password"
              label="Temporary Password"
              helperText="Minimum 6 characters"
              value={newUser.password}
              onChange={(e) =>
                handleUserChange(
                  "password",
                  e.target.value
                )
              }
            />

            <TextField
              fullWidth
              select
              label="Role"
              value={newUser.role}
              onChange={(e) =>
                handleUserChange(
                  "role",
                  e.target.value
                )
              }
            >
              <MenuItem value="user">
                User
              </MenuItem>

              <MenuItem value="admin">
                Administrator
              </MenuItem>
            </TextField>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeUserDialog}
            disabled={creatingUser}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleCreateUser}
            disabled={creatingUser}
          >
            {creatingUser
              ? "Creating..."
              : "Create User"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}