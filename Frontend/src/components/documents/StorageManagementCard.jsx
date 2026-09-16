import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import StorageIcon from "@mui/icons-material/Storage";
import WarningIcon from "@mui/icons-material/Warning";

import toast from "react-hot-toast";

import { supabase } from "../../lib/supabase";

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(2)} KB`;
  }

  if (value < 1024 ** 3) {
    return `${(value / 1024 ** 2).toFixed(2)} MB`;
  }

  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatPercentage(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function getStatusColor(status) {
  if (status === "CRITICAL") {
    return "error";
  }

  if (status === "WARNING") {
    return "warning";
  }

  if (status === "DISABLED") {
    return "default";
  }

  return "success";
}

function getStatusLabel(status) {
  if (status === "CRITICAL") {
    return "Critical";
  }

  if (status === "WARNING") {
    return "Warning";
  }

  if (status === "DISABLED") {
    return "Disabled";
  }

  return "Normal";
}

export default function StorageManagementCard({
  isAdmin = false,
}) {
  const [settings, setSettings] = useState({
    storage_capacity_bytes: 10737418240,
    warning_threshold_percent: 80,
    critical_threshold_percent: 95,
    is_enabled: true,
  });

  const [statistics, setStatistics] = useState(null);
  const [notifications, setNotifications] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [capacityGb, setCapacityGb] = useState("10");

  async function loadStorageData() {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [
        settingsResult,
        statisticsResult,
        notificationsResult,
      ] = await Promise.all([
        supabase
          .from("document_storage_settings")
          .select(
            "storage_capacity_bytes, warning_threshold_percent, critical_threshold_percent, is_enabled"
          )
          .limit(1)
          .maybeSingle(),

        supabase.rpc(
          "get_document_storage_statistics"
        ),

        supabase
          .from("document_storage_notifications")
          .select(
            "id, notification_type, severity, title, message, usage_percent, used_bytes, capacity_bytes, threshold_percent, created_at, read_at"
          )
          .order("created_at", {
            ascending: false,
          })
          .limit(10),
      ]);

      if (settingsResult.error) {
        throw settingsResult.error;
      }

      if (statisticsResult.error) {
        throw statisticsResult.error;
      }

      if (notificationsResult.error) {
        throw notificationsResult.error;
      }

      if (settingsResult.data) {
        setSettings(settingsResult.data);

        setCapacityGb(
          (
            Number(
              settingsResult.data.storage_capacity_bytes || 0
            ) /
            1024 ** 3
          ).toString()
        );
      }

      setStatistics(statisticsResult.data || null);
      setNotifications(notificationsResult.data || []);
    } catch (error) {
      console.error(
        "Storage management load error:",
        error
      );

      toast.error(
        error?.message ||
          "Unable to load storage information."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStorageData();
  }, [isAdmin]);

  async function handleSave() {
    if (!isAdmin) {
      return;
    }

    const capacity = Number(capacityGb);
    const warning = Number(
      settings.warning_threshold_percent
    );
    const critical = Number(
      settings.critical_threshold_percent
    );

    if (!Number.isFinite(capacity) || capacity <= 0) {
      toast.error(
        "Storage capacity must be greater than zero."
      );
      return;
    }

    if (
      !Number.isFinite(warning) ||
      warning <= 0 ||
      warning >= 100
    ) {
      toast.error(
        "Warning threshold must be between 0 and 100."
      );
      return;
    }

    if (
      !Number.isFinite(critical) ||
      critical <= warning ||
      critical > 100
    ) {
      toast.error(
        "Critical threshold must be greater than the warning threshold."
      );
      return;
    }

    try {
      setSaving(true);

      const capacityBytes = Math.round(
        capacity * 1024 ** 3
      );

      const { error } = await supabase.rpc(
        "update_document_storage_settings",
        {
          p_capacity_bytes: capacityBytes,
          p_warning_threshold_percent: warning,
          p_critical_threshold_percent: critical,
          p_is_enabled: Boolean(settings.is_enabled),
        }
      );

      if (error) {
        throw error;
      }

      toast.success(
        "Storage settings saved successfully."
      );

      await loadStorageData();
    } catch (error) {
      console.error(
        "Storage settings save error:",
        error
      );

      toast.error(
        error?.message ||
          "Unable to save storage settings."
      );
    } finally {
      setSaving(false);
    }
  }

  async function markNotificationRead(notificationId) {
    if (!isAdmin) {
      return;
    }

    try {
      const { data: userResult } =
        await supabase.auth.getUser();

      const userId = userResult?.user?.id || null;

      const { error } = await supabase
        .from("document_storage_notifications")
        .update({
          read_at: new Date().toISOString(),
          read_by: userId,
        })
        .eq("id", notificationId);

      if (error) {
        throw error;
      }

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                read_at:
                  new Date().toISOString(),
              }
            : notification
        )
      );
    } catch (error) {
      console.error(
        "Storage notification update error:",
        error
      );

      toast.error(
        error?.message ||
          "Unable to mark notification as read."
      );
    }
  }

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              py: 4,
            }}
          >
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  const usagePercent = Number(
    statistics?.usage_percent || 0
  );

  const progressValue = Math.min(
    Math.max(usagePercent, 0),
    100
  );

  const status =
    statistics?.status || "NORMAL";

  const categoryBreakdown =
    statistics?.category_breakdown || [];

  const mimeBreakdown =
    statistics?.mime_breakdown || [];

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack
          direction={{
            xs: "column",
            sm: "row",
          }}
          justifyContent="space-between"
          alignItems={{
            xs: "stretch",
            sm: "center",
          }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
            >
              <StorageIcon />
              <Typography
                variant="h6"
                fontWeight={700}
              >
                Document Storage
              </Typography>
            </Stack>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              Monitor document storage usage,
              capacity and administrator alerts.
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={1}
          >
            <Chip
              label={getStatusLabel(status)}
              color={getStatusColor(status)}
            />

            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadStorageData}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              type="number"
              label="Storage Capacity"
              value={capacityGb}
              onChange={(event) =>
                setCapacityGb(event.target.value)
              }
              inputProps={{
                min: 0.01,
                step: 0.01,
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              type="number"
              label="Warning Threshold"
              value={
                settings.warning_threshold_percent
              }
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  warning_threshold_percent:
                    event.target.value,
                }))
              }
              InputProps={{
                endAdornment: (
                  <Typography>%</Typography>
                ),
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              type="number"
              label="Critical Threshold"
              value={
                settings.critical_threshold_percent
              }
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  critical_threshold_percent:
                    event.target.value,
                }))
              }
              InputProps={{
                endAdornment: (
                  <Typography>%</Typography>
                ),
              }}
            />
          </Grid>
        </Grid>

        <Button
          sx={{ mt: 2 }}
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? "Saving..."
            : "Save Storage Settings"}
        </Button>

        <Divider sx={{ my: 3 }} />

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Capacity
            </Typography>
            <Typography
              variant="h6"
              fontWeight={700}
            >
              {formatBytes(
                statistics?.capacity_bytes
              )}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Used
            </Typography>
            <Typography
              variant="h6"
              fontWeight={700}
            >
              {formatBytes(
                statistics?.used_bytes
              )}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Available
            </Typography>
            <Typography
              variant="h6"
              fontWeight={700}
            >
              {formatBytes(
                statistics?.available_bytes
              )}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Usage
            </Typography>
            <Typography
              variant="h6"
              fontWeight={700}
            >
              {formatPercentage(usagePercent)}
            </Typography>
          </Grid>
        </Grid>

        <Box sx={{ mt: 3 }}>
          <LinearProgress
            variant="determinate"
            value={progressValue}
            sx={{
              height: 10,
              borderRadius: 5,
            }}
          />

          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ mt: 1 }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
            >
              Warning:{" "}
              {formatPercentage(
                settings.warning_threshold_percent
              )}
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              Critical:{" "}
              {formatPercentage(
                settings.critical_threshold_percent
              )}
            </Typography>
          </Stack>
        </Box>

        <Divider sx={{ my: 3 }} />

        <Typography
          variant="subtitle1"
          fontWeight={700}
          sx={{ mb: 2 }}
        >
          Storage by Document Category
        </Typography>

        {categoryBreakdown.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
          >
            No active documents are currently stored.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {categoryBreakdown.map((item) => (
              <Stack
                key={item.category}
                direction="row"
                justifyContent="space-between"
              >
                <Typography>
                  {item.category}
                </Typography>

                <Typography fontWeight={600}>
                  {formatBytes(item.bytes)} (
                  {item.file_count} files)
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 3 }} />

        <Typography
          variant="subtitle1"
          fontWeight={700}
          sx={{ mb: 2 }}
        >
          Storage by File Type
        </Typography>

        {mimeBreakdown.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
          >
            No file-type data available.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {mimeBreakdown.map((item) => (
              <Stack
                key={item.mime_type}
                direction="row"
                justifyContent="space-between"
              >
                <Typography>
                  {item.mime_type}
                </Typography>

                <Typography fontWeight={600}>
                  {formatBytes(item.bytes)} (
                  {item.file_count} files)
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 3 }} />

        <Typography
          variant="subtitle1"
          fontWeight={700}
          sx={{ mb: 2 }}
        >
          Administrator Notifications
        </Typography>

        {notifications.length === 0 ? (
          <Alert severity="success">
            No active storage warnings or critical
            notifications.
          </Alert>
        ) : (
          <Stack spacing={2}>
            {notifications.map(
              (notification) => (
                <Alert
                  key={notification.id}
                  severity={
                    notification.severity ===
                    "CRITICAL"
                      ? "error"
                      : "warning"
                  }
                  icon={<WarningIcon />}
                  action={
                    !notification.read_at ? (
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() =>
                          markNotificationRead(
                            notification.id
                          )
                        }
                      >
                        Mark read
                      </Button>
                    ) : null
                  }
                >
                  <Typography
                    fontWeight={700}
                  >
                    {notification.title}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{ mt: 0.5 }}
                  >
                    {notification.message}
                  </Typography>

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 0.5 }}
                  >
                    Usage:{" "}
                    {formatPercentage(
                      notification.usage_percent
                    )}
                  </Typography>
                </Alert>
              )
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}