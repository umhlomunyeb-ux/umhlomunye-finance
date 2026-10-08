import { useEffect, useState } from "react";
import QRCode from "qrcode";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
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
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import DeleteIcon from "@mui/icons-material/Delete";
import DevicesIcon from "@mui/icons-material/Devices";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import ImageIcon from "@mui/icons-material/Image";

import toast from "react-hot-toast";

import {
  DEFAULT_SETTINGS,
  getSystemSettings,
  updateSystemSettings,
  createMobilePairing,
  getMobileDevices,
  revokeMobileDevice,
  revokeAllMobileDevices,
} from "../../services/settingsService";

import {
  getCurrentUserProfile,
  isCurrentUserAdmin,
  getUsers,
  createUser,
} from "../../services/userService";

import { supabase } from "../../lib/supabase";

import StorageManagementCard from "../../components/documents/StorageManagementCard";

export default function Settings() {
  const [settings, setSettings] =
    useState(DEFAULT_SETTINGS);

  const [profile, setProfile] =
    useState(null);

  const [isAdmin, setIsAdmin] =
    useState(false);

  const [users, setUsers] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [loadingUsers, setLoadingUsers] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [creatingUser, setCreatingUser] =
    useState(false);

  /* ============================================================
     COMPANY LOGO
     ============================================================ */

  const [logoFile, setLogoFile] =
    useState(null);

  const [logoPreview, setLogoPreview] =
    useState("");

  const [removingLogo, setRemovingLogo] =
    useState(false);

  const [removeLogoRequested, setRemoveLogoRequested] =
    useState(false);

  /* ============================================================
     MOBILE APP SETUP
     ============================================================ */

  const [creatingPairing, setCreatingPairing] =
    useState(false);

  const [pairingResult, setPairingResult] =
    useState(null);

  const [pairingQrCode, setPairingQrCode] =
    useState("");

  const [pairingSecondsRemaining, setPairingSecondsRemaining] =
    useState(0);

  const [mobileDevices, setMobileDevices] =
    useState([]);

  const [loadingMobileDevices, setLoadingMobileDevices] =
    useState(false);

  const [revokingDeviceId, setRevokingDeviceId] =
    useState(null);

  const [revokingAllDevices, setRevokingAllDevices] =
    useState(false);

  const [error, setError] =
    useState("");

  const [userDialogOpen, setUserDialogOpen] =
    useState(false);

  const [newUser, setNewUser] =
    useState({
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

  /*
   * Keep company logo preview synchronized with the saved logo.
   */
  useEffect(() => {
    if (
      settings?.company_logo_url &&
      !logoFile &&
      !removeLogoRequested
    ) {
      setLogoPreview(
        settings.company_logo_url
      );
    }
  }, [
    settings.company_logo_url,
    logoFile,
    removeLogoRequested,
  ]);

  /*
   * Clean up locally generated object URLs.
   */
  useEffect(() => {
    return () => {
      if (
        logoPreview &&
        logoPreview.startsWith("blob:")
      ) {
        URL.revokeObjectURL(
          logoPreview
        );
      }
    };
  }, [logoPreview]);

  /*
   * Keep the pairing expiry countdown accurate.
   */
  useEffect(() => {
    if (!pairingResult?.expires_at) {
      setPairingSecondsRemaining(0);
      return undefined;
    }

    function updateCountdown() {
      const expiresAt =
        new Date(
          pairingResult.expires_at
        ).getTime();

      const remaining =
        Math.max(
          0,
          Math.ceil(
            (expiresAt - Date.now()) / 1000
          )
        );

      setPairingSecondsRemaining(
        remaining
      );
    }

    updateCountdown();

    const interval =
      window.setInterval(
        updateCountdown,
        1000
      );

    return () =>
      window.clearInterval(
        interval
      );
  }, [pairingResult]);

  /*
   * Generate the QR code whenever a new pairing credential is
   * received.
   *
   * Only pairing information is encoded.
   * No user password or permanent credential is included.
   */
  useEffect(() => {
    let cancelled = false;

    async function generatePairingQr() {
      if (
        !pairingResult?.installation_id ||
        !pairingResult?.pairing_token
      ) {
        setPairingQrCode("");
        return;
      }

      try {
        const pairingUrl =
          window.location.origin +
          "/mobile?installation_id=" +
          encodeURIComponent(pairingResult.installation_id) +
          "&pairing_token=" +
          encodeURIComponent(pairingResult.pairing_token);

        const dataUrl =
          await QRCode.toDataURL(
            pairingUrl,
            {
              errorCorrectionLevel: "M",
              margin: 2,
              width: 320,
            }
          );

        if (!cancelled) {
          setPairingQrCode(dataUrl);
        }
      } catch (err) {
        console.error(
          "Generate mobile pairing QR error:",
          err
        );

        if (!cancelled) {
          setPairingQrCode("");

          toast.error(
            "Unable to generate the mobile pairing QR code."
          );
        }
      }
    }

    generatePairingQr();

    return () => {
      cancelled = true;
    };
  }, [pairingResult]);

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const [
        settingsData,
        currentProfile,
        adminStatus,
      ] = await Promise.all([
        getSystemSettings(),
        getCurrentUserProfile(),
        isCurrentUserAdmin(),
      ]);

      setSettings({
        ...DEFAULT_SETTINGS,
        ...settingsData,
      });

      if (settingsData?.company_logo_url) {
        setLogoPreview(
          settingsData.company_logo_url
        );
      } else {
        setLogoPreview("");
      }

      setProfile(currentProfile);
      setIsAdmin(Boolean(adminStatus));

      if (adminStatus) {
        await Promise.all([
          loadUsers(),
          loadMobileDevices(),
        ]);
      }
    } catch (err) {
      console.error(
        "Settings load error:",
        err
      );

      setError(
        err.message ||
          "Unable to load settings."
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
      console.error(
        "Users load error:",
        err
      );

      toast.error(
        err.message ||
          "Unable to load users."
      );
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadMobileDevices() {
    if (!isAdmin) return;

    try {
      setLoadingMobileDevices(true);

      const data =
        await getMobileDevices();

      setMobileDevices(
        Array.isArray(data)
          ? data
          : []
      );
    } catch (err) {
      console.error(
        "Mobile devices load error:",
        err
      );

      toast.error(
        err.message ||
          "Unable to load connected mobile devices."
      );
    } finally {
      setLoadingMobileDevices(false);
    }
  }

  function handleChange(field, value) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  /* ============================================================
     COMPANY LOGO HELPERS
     ============================================================ */

  function handleLogoFileChange(event) {
    const file =
      event.target.files?.[0] ||
      null;

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error(
        "Please select an image file."
      );

      event.target.value = "";
      return;
    }

    const maxSize =
      5 * 1024 * 1024;

    if (file.size > maxSize) {
      toast.error(
        "Company logo must be 5 MB or smaller."
      );

      event.target.value = "";
      return;
    }

    if (
      logoPreview &&
      logoPreview.startsWith("blob:")
    ) {
      URL.revokeObjectURL(
        logoPreview
      );
    }

    const previewUrl =
      URL.createObjectURL(file);

    setLogoFile(file);
    setLogoPreview(previewUrl);
    setRemoveLogoRequested(false);

    event.target.value = "";
  }

  function handleRemoveLogo() {
    if (!settings.company_logo_url && !logoFile) {
      return;
    }

    if (
      logoPreview &&
      logoPreview.startsWith("blob:")
    ) {
      URL.revokeObjectURL(
        logoPreview
      );
    }

    setLogoFile(null);
    setLogoPreview("");
    setRemoveLogoRequested(true);
  }

  function getStoragePathFromLogoUrl(
    logoUrl
  ) {
    if (!logoUrl) {
      return null;
    }

    try {
      const url =
        new URL(logoUrl);

      const marker =
        "/storage/v1/object/";

      const markerIndex =
        url.pathname.indexOf(
          marker
        );

      if (markerIndex === -1) {
        return null;
      }

      const objectPart =
        url.pathname.substring(
          markerIndex + marker.length
        );

      const publicMarker =
        "public/company-assets/";

      const authenticatedMarker =
        "company-assets/";

      if (
        objectPart.startsWith(
          publicMarker
        )
      ) {
        return decodeURIComponent(
          objectPart.substring(
            publicMarker.length
          )
        );
      }

      if (
        objectPart.startsWith(
          authenticatedMarker
        )
      ) {
        return decodeURIComponent(
          objectPart.substring(
            authenticatedMarker.length
          )
        );
      }

      return null;
    } catch (err) {
      console.warn(
        "Unable to determine company logo storage path:",
        err
      );

      return null;
    }
  }

  async function uploadCompanyLogo() {
    if (!logoFile) {
      return null;
    }

    const extension =
      logoFile.name
        ?.split(".")
        .pop()
        ?.toLowerCase() || "png";

    const filePath =
      `company-logo/${crypto.randomUUID()}.${extension}`;

    const {
      error: uploadError,
    } = await supabase.storage
      .from("company-assets")
      .upload(
        filePath,
        logoFile,
        {
          upsert: false,
          contentType:
            logoFile.type,
          cacheControl:
            "3600",
        }
      );

    if (uploadError) {
      throw new Error(
        uploadError.message ||
          "Unable to upload the company logo."
      );
    }

    const {
      data: publicUrlData,
    } =
      supabase.storage
        .from("company-assets")
        .getPublicUrl(
          filePath
        );

    const publicUrl =
      publicUrlData?.publicUrl;

    if (!publicUrl) {
      throw new Error(
        "The company logo was uploaded but its public URL could not be created."
      );
    }

    return publicUrl;
  }

  async function removeCompanyLogoFromStorage(
    logoUrl
  ) {
    const path =
      getStoragePathFromLogoUrl(
        logoUrl
      );

    if (!path) {
      return;
    }

    const {
      error: removeError,
    } = await supabase.storage
      .from("company-assets")
      .remove([path]);

    if (removeError) {
      console.warn(
        "Unable to remove previous company logo:",
        removeError
      );
    }
  }

  /* ============================================================
     SETTINGS VALIDATION
     ============================================================ */

  function validateSettings() {
    const minimum = Number(settings.minimum_loan_amount);
    const maximum = Number(settings.maximum_loan_amount);
    const interestRate = Number(settings.tier_1_interest_rate);
    const termMonths = Number(settings.maximum_loan_term_months);
    const cycleDays = Number(settings.interest_cycle_days);
    const cycleEnabled = settings.interest_cycle_enabled;
    const cycleTime = settings.interest_cycle_time;
    const timezone = settings.timezone;

    if (!settings.company_name?.trim()) {
      return "Company name is required.";
    }

    if (!Number.isFinite(minimum) || minimum <= 0) {
      return "Minimum loan amount must be greater than zero.";
    }

    if (!Number.isFinite(maximum) || maximum < minimum) {
      return "Maximum loan amount must be greater than or equal to minimum loan amount.";
    }

    if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 100) {
      return "Interest rate must be between 0% and 100%.";
    }

    if (!Number.isFinite(termMonths) || termMonths <= 0 || termMonths > 2) {
      return "Term must be between 1 and 2 months.";
    }

    if (typeof cycleEnabled !== "boolean") {
      return "Interest cycle enabled setting is invalid.";
    }

    if (cycleEnabled) {
      if (!Number.isFinite(cycleDays) || cycleDays <= 0) {
        return "Interest cycle must be greater than zero days.";
      }

      if (
        typeof cycleTime !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(cycleTime)
      ) {
        return "Interest cycle time must be a valid time in HH:MM format.";
      }
    }

    if (typeof timezone !== "string" || !timezone.trim()) {
      return "Timezone must be configured.";
    }

    return null;
  }

  /* ============================================================
     SAVE SETTINGS
     ============================================================ */

  async function handleSave() {
    if (!isAdmin) {
      toast.error(
        "Only administrators can change settings."
      );

      return;
    }

    try {
      setError("");

      const validationError =
        validateSettings();

      if (validationError) {
        setError(
          validationError
        );

        return;
      }

      setSaving(true);

      const oldLogoUrl =
        settings.company_logo_url ||
        null;

      let newLogoUrl =
        settings.company_logo_url ||
        null;

      /*
       * Upload a new logo first.
       *
       * The existing logo is deliberately not deleted until
       * the settings update succeeds.
       */
      if (logoFile) {
        newLogoUrl =
          await uploadCompanyLogo();
      } else if (
        removeLogoRequested
      ) {
        newLogoUrl = null;
      }

      const settingsToSave = {
        ...settings,
        company_logo_url:
          newLogoUrl,
      };

      const saved =
        await updateSystemSettings(
          settingsToSave
        );

      setSettings({
        ...DEFAULT_SETTINGS,
        ...saved,
      });

      setLogoFile(null);
      setRemoveLogoRequested(false);

      if (saved.company_logo_url) {
        setLogoPreview(
          saved.company_logo_url
        );
      } else {
        setLogoPreview("");
      }

      /*
       * Delete the previous logo only after the database has
       * successfully stored the new value.
       */
      if (
        oldLogoUrl &&
        oldLogoUrl !==
          saved.company_logo_url
      ) {
        await removeCompanyLogoFromStorage(
          oldLogoUrl
        );
      }

      toast.success(
        "System and loan rules saved successfully."
      );
    } catch (err) {
      console.error(
        "Save settings error:",
        err
      );

      setError(
        err.message ||
          "Unable to save settings."
      );

      toast.error(
        err.message ||
          "Unable to save settings."
      );
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!isAdmin) {
      toast.error(
        "Only administrators can restore settings."
      );

      return;
    }

    setSettings({
      ...DEFAULT_SETTINGS,
    });

    setLogoFile(null);
    setLogoPreview("");
    setRemoveLogoRequested(true);

    setError("");

    toast.success(
      "Default rules restored. Click Save to apply them."
    );
  }

  /* ============================================================
     MOBILE APP SETUP
     ============================================================ */

  async function handleGenerateMobilePairing() {
    if (!isAdmin) {
      toast.error(
        "Only administrators can generate mobile pairing credentials."
      );

      return;
    }

    try {
      setCreatingPairing(true);

      setPairingResult(null);
      setPairingQrCode("");
      setPairingSecondsRemaining(0);

      const result =
        await createMobilePairing();

      setPairingResult(result);

      toast.success(
        "Mobile app pairing generated successfully."
      );
    } catch (err) {
      console.error(
        "Mobile pairing generation error:",
        err
      );

      toast.error(
        err.message ||
          "Unable to generate mobile pairing credentials."
      );
    } finally {
      setCreatingPairing(false);
    }
  }

  async function handleRevokeMobileDevice(
    deviceId
  ) {
    if (!isAdmin) {
      toast.error(
        "Only administrators can revoke mobile devices."
      );

      return;
    }

    if (!deviceId) {
      toast.error(
        "Mobile device ID is missing."
      );

      return;
    }

    const confirmed =
      window.confirm(
        "Are you sure you want to revoke this mobile device? The device will need to be paired again before it can connect to this LMS."
      );

    if (!confirmed) {
      return;
    }

    try {
      setRevokingDeviceId(
        deviceId
      );

      await revokeMobileDevice(
        deviceId
      );

      toast.success(
        "Mobile device revoked successfully."
      );

      await loadMobileDevices();
    } catch (err) {
      console.error(
        "Revoke mobile device error:",
        err
      );

      toast.error(
        err.message ||
          "Unable to revoke mobile device."
      );
    } finally {
      setRevokingDeviceId(
        null
      );
    }
  }

  async function handleRevokeAllMobileDevices() {
    if (!isAdmin) {
      toast.error(
        "Only administrators can revoke mobile devices."
      );

      return;
    }

    if (!mobileDevices.length) {
      toast(
        "There are no connected mobile devices to revoke."
      );

      return;
    }

    const confirmed =
      window.confirm(
        "Are you sure you want to revoke ALL connected mobile devices? Every device will need to be paired again before it can connect to this LMS."
      );

    if (!confirmed) {
      return;
    }

    try {
      setRevokingAllDevices(
        true
      );

      const result =
        await revokeAllMobileDevices();

      const count =
        Number(result) || 0;

      toast.success(
        count > 0
          ? `${count} mobile device${count === 1 ? "" : "s"} revoked successfully.`
          : "All mobile devices have been revoked."
      );

      await loadMobileDevices();
    } catch (err) {
      console.error(
        "Revoke all mobile devices error:",
        err
      );

      toast.error(
        err.message ||
          "Unable to revoke mobile devices."
      );
    } finally {
      setRevokingAllDevices(
        false
      );
    }
  }

  function formatCountdown(seconds) {
    if (!seconds || seconds <= 0) {
      return "Expired";
    }

    const minutes =
      Math.floor(seconds / 60);

    const remainingSeconds =
      seconds % 60;

    return `${minutes}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "-";
    }

    return date.toLocaleString(
      "en-ZA"
    );
  }

  function getPushStatus(device) {
    if (device?.push_enabled) {
      return {
        label: "Enabled",
        color: "success",
      };
    }

    return {
      label: "Disabled",
      color: "default",
    };
  }

  function getDeviceStatus(device) {
    if (device?.revoked_at) {
      return {
        label: "Revoked",
        color: "error",
      };
    }

    return {
      label: "Connected",
      color: "success",
    };
  }

  /* ============================================================
     USER MANAGEMENT
     ============================================================ */

  function handleUserChange(
    field,
    value
  ) {
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
      toast.error(
        "Only administrators can create users."
      );

      return;
    }

    if (!newUser.username.trim()) {
      toast.error(
        "Enter a username."
      );

      return;
    }

    if (!newUser.full_name.trim()) {
      toast.error(
        "Enter the user's full name."
      );

      return;
    }

    if (!newUser.email.trim()) {
      toast.error(
        "Enter the user's email."
      );

      return;
    }

    if (
      !newUser.password ||
      newUser.password.length < 6
    ) {
      toast.error(
        "Password must be at least 6 characters."
      );

      return;
    }

    try {
      setCreatingUser(true);

      await createUser({
        username:
          newUser.username.trim(),

        full_name:
          newUser.full_name.trim(),

        email:
          newUser.email.trim(),

        cellphone:
          newUser.cellphone.trim(),

        password:
          newUser.password,

        role:
          newUser.role,
      });

      toast.success(
        "User created successfully."
      );

      closeUserDialog();

      await loadUsers();
    } catch (err) {
      console.error(
        "Create user error:",
        err
      );

      toast.error(
        err.message ||
          "Unable to create user."
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
      {/* =========================================================
          SETTINGS HEADER
          ========================================================= */}
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="h4"
          fontWeight={700}
        >
          Settings
        </Typography>

        <Typography color="text.secondary">
          Manage{" "}
          {settings.system_name ||
            "LMS"}{" "}
          system and loan rules.
        </Typography>

        {profile && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            Signed in as:{" "}
            <strong>
              {profile.full_name ||
                profile.username}
            </strong>
          </Typography>
        )}
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
        >
          {error}
        </Alert>
      )}

      {!isAdmin && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
        >
          You can view system settings, but only an active
          administrator can change loan rules or manage users.
        </Alert>
      )}

      {/* =========================================================
          COMPANY SETTINGS
          ========================================================= */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography
            variant="h6"
            fontWeight={700}
          >
            Company Settings
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Company information used throughout the LMS,
            documents and official company records.
          </Typography>

          <Grid
            container
            spacing={2}
          >
            {/* COMPANY NAME */}
            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                label="Company Name"
                value={
                  settings.company_name ||
                  ""
                }
                onChange={(e) =>
                  handleChange(
                    "company_name",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
              />
            </Grid>

            {/* SHORT NAME */}
            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                label="Short Name"
                value={
                  settings.short_name ||
                  ""
                }
                onChange={(e) =>
                  handleChange(
                    "short_name",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                helperText="Used only to generate the mobile app name as Short Name + LMS."
              />
            </Grid>

            {/* COMPANY ADDRESS */}
            <Grid
              size={{
                xs: 12,
              }}
            >
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Company Address"
                value={
                  settings.company_address ||
                  ""
                }
                onChange={(e) =>
                  handleChange(
                    "company_address",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                helperText="Used on company documents and official correspondence."
              />
            </Grid>

            {/* COMPANY LOGO */}
            <Grid
              size={{
                xs: 12,
              }}
            >
              <Card
                variant="outlined"
              >
                <CardContent>
                  <Stack
                    direction={{
                      xs: "column",
                      sm: "row",
                    }}
                    spacing={2}
                    alignItems={{
                      xs: "stretch",
                      sm: "center",
                    }}
                  >
                    <Box
                      sx={{
                        width: 150,
                        height: 100,
                        border: "1px dashed",
                        borderColor:
                          "divider",
                        borderRadius: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        backgroundColor:
                          "action.hover",
                        flexShrink: 0,
                      }}
                    >
                      {logoPreview ? (
                        <Box
                          component="img"
                          src={logoPreview}
                          alt="Company logo preview"
                          sx={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit:
                              "contain",
                          }}
                        />
                      ) : (
                        <Stack
                          alignItems="center"
                          spacing={0.5}
                          color="text.secondary"
                        >
                          <ImageIcon />
                          <Typography
                            variant="caption"
                          >
                            No logo
                          </Typography>
                        </Stack>
                      )}
                    </Box>

                    <Box
                      sx={{
                        flex: 1,
                      }}
                    >
                      <Typography
                        variant="subtitle1"
                        fontWeight={700}
                      >
                        Company Logo
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 1.5 }}
                      >
                        Upload the company logo used for
                        system branding and official documents.
                        Maximum size: 5 MB.
                      </Typography>

                      <Stack
                        direction={{
                          xs: "column",
                          sm: "row",
                        }}
                        spacing={1}
                      >
                        <Button
                          variant="outlined"
                          component="label"
                          startIcon={
                            <CloudUploadIcon />
                          }
                          disabled={
                            !isAdmin ||
                            saving
                          }
                        >
                          {logoFile
                            ? "Choose Different Logo"
                            : "Upload Logo"}

                          <input
                            hidden
                            type="file"
                            accept="image/*"
                            onChange={
                              handleLogoFileChange
                            }
                          />
                        </Button>

                        {(logoPreview ||
                          settings.company_logo_url ||
                          logoFile) && (
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={
                              <DeleteIcon />
                            }
                            onClick={
                              handleRemoveLogo
                            }
                            disabled={
                              !isAdmin ||
                              saving ||
                              removingLogo
                            }
                          >
                            Remove Logo
                          </Button>
                        )}
                      </Stack>

                      {logoFile && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: "block",
                            mt: 1,
                          }}
                        >
                          Selected:{" "}
                          {logoFile.name}
                        </Typography>
                      )}

                      {removeLogoRequested && (
                        <Alert
                          severity="warning"
                          sx={{ mt: 1.5 }}
                        >
                          The company logo will be removed when
                          you click Save.
                        </Alert>
                      )}
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* FINANCIAL YEAR END */}
            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                select
                label="Financial Year End"
                value={
                  settings.financial_year_end ??
                  ""
                }
                onChange={(e) =>
                  handleChange(
                    "financial_year_end",
                    e.target.value
                      ? Number(
                          e.target.value
                        )
                      : null
                  )
                }
                disabled={!isAdmin}
                helperText="Select the month in which the company's financial year ends."
              >
                <MenuItem value="">
                  Not configured
                </MenuItem>

                <MenuItem value={1}>
                  January
                </MenuItem>

                <MenuItem value={2}>
                  February
                </MenuItem>

                <MenuItem value={3}>
                  March
                </MenuItem>

                <MenuItem value={4}>
                  April
                </MenuItem>

                <MenuItem value={5}>
                  May
                </MenuItem>

                <MenuItem value={6}>
                  June
                </MenuItem>

                <MenuItem value={7}>
                  July
                </MenuItem>

                <MenuItem value={8}>
                  August
                </MenuItem>

                <MenuItem value={9}>
                  September
                </MenuItem>

                <MenuItem value={10}>
                  October
                </MenuItem>

                <MenuItem value={11}>
                  November
                </MenuItem>

                <MenuItem value={12}>
                  December
                </MenuItem>
              </TextField>
            </Grid>

            {/* CURRENCY */}
            <Grid
              size={{
                xs: 12,
                md: 3,
              }}
            >
              <TextField
                fullWidth
                label="Currency"
                value={
                  settings.currency ||
                  ""
                }
                onChange={(e) =>
                  handleChange(
                    "currency",
                    e.target.value.toUpperCase()
                  )
                }
                disabled={!isAdmin}
              />
            </Grid>

            {/* TIMEZONE */}
            <Grid
              size={{
                xs: 12,
                md: 3,
              }}
            >
              <TextField
                fullWidth
                label="Timezone"
                value={
                  settings.timezone ||
                  ""
                }
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

      {/* =========================================================
          LOAN RULES
          ========================================================= */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700}>
            Loan Rules
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Configure the five loan rules used by the LMS: minimum amount,
            maximum amount, interest rate, term and interest cycle.
          </Typography>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label="Minimum Amount"
                value={settings.minimum_loan_amount ?? ""}
                onChange={(e) => handleChange("minimum_loan_amount", e.target.value)}
                disabled={!isAdmin}
                inputProps={{ min: 0, step: "0.01" }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label="Maximum Amount"
                value={settings.maximum_loan_amount ?? ""}
                onChange={(e) => handleChange("maximum_loan_amount", e.target.value)}
                disabled={!isAdmin}
                inputProps={{ min: 0, step: "0.01" }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label="Interest Rate (%)"
                value={settings.tier_1_interest_rate ?? ""}
                onChange={(e) => handleChange("tier_1_interest_rate", e.target.value)}
                disabled={!isAdmin}
                inputProps={{ min: 0, max: 100, step: "0.01" }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label="Term (Months)"
                value={settings.maximum_loan_term_months ?? ""}
                onChange={(e) => handleChange("maximum_loan_term_months", e.target.value)}
                disabled={!isAdmin}
                inputProps={{ min: 1, max: 2, step: 1 }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(settings.interest_cycle_enabled)}
                    onChange={(e) => handleChange("interest_cycle_enabled", e.target.checked)}
                    disabled={!isAdmin}
                  />
                }
                label="Enable Interest Cycle"
              />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label="Interest Cycle (Days)"
                value={settings.interest_cycle_days ?? ""}
                onChange={(e) => handleChange("interest_cycle_days", e.target.value)}
                disabled={!isAdmin || !settings.interest_cycle_enabled}
                inputProps={{ min: 1, step: 1 }}
              />
            </Grid>

          </Grid>
        </CardContent>
      </Card>

      {/* =========================================================
          MOBILE ACCESS
          ========================================================= */}
      {isAdmin && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={2}
              sx={{ mb: 2 }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <SmartphoneIcon />
                  <Typography variant="h6" fontWeight={700}>
                    Mobile Access
                  </Typography>
                </Stack>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  Open the mobile financial dashboard from any phone browser.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                startIcon={<SmartphoneIcon />}
                onClick={() =>
                  window.open(
                    window.location.origin + "/mobile/login",
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                Open Mobile
              </Button>
            </Stack>

            <Alert severity="info" sx={{ mb: 3 }}>
              The mobile version uses the normal LMS username and password.
              No device pairing or temporary pairing code is required.
            </Alert>

            <Card variant="outlined">
              <CardContent>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ mb: 1 }}
                >
                  Mobile Access Link
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2 }}
                >
                  Share this link with authorised LMS users. Opening it on a
                  phone takes them to the mobile login screen for this LMS.
                </Typography>

                <TextField
                  fullWidth
                  value={
                    window.location.origin +
                    "/mobile/login"
                  }
                  InputProps={{
                    readOnly: true,
                  }}
                  sx={{ mb: 2 }}
                />

                <Button
                  variant="contained"
                  startIcon={<SmartphoneIcon />}
                  onClick={async () => {
                    const link =
                      window.location.origin +
                      "/mobile/login";

                    try {
                      await navigator.clipboard.writeText(link);
                      toast.success(
                        "Mobile access link copied."
                      );
                    } catch (error) {
                      console.error(
                        "Copy mobile access link error:",
                        error
                      );
                      toast.error(
                        "Unable to copy the mobile access link."
                      );
                    }
                  }}
                >
                  Copy Mobile Link
                </Button>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      )}

      {/* =========================================================
          USER MANAGEMENT
          ========================================================= */}
      {isAdmin && (
        <Card>
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
                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  User Management
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Create and manage system users.
                </Typography>
              </Box>

              <Stack
                direction="row"
                spacing={1}
              >
                <Button
                  variant="outlined"
                  startIcon={
                    <RefreshIcon />
                  }
                  onClick={
                    loadUsers
                  }
                  disabled={
                    loadingUsers
                  }
                >
                  Refresh
                </Button>

                <Button
                  variant="contained"
                  startIcon={
                    <PersonAddIcon />
                  }
                  onClick={() =>
                    setUserDialogOpen(
                      true
                    )
                  }
                >
                  Create User
                </Button>
              </Stack>
            </Stack>

            {loadingUsers ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent:
                    "center",
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
                      <TableCell>
                        Username
                      </TableCell>

                      <TableCell>
                        Full Name
                      </TableCell>

                      <TableCell>
                        Email
                      </TableCell>

                      <TableCell>
                        Role
                      </TableCell>

                      <TableCell>
                        Status
                      </TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {users.map(
                      (user) => (
                        <TableRow
                          key={
                            user.id
                          }
                        >
                          <TableCell>
                            {user.username ||
                              "-"}
                          </TableCell>

                          <TableCell>
                            {user.full_name ||
                              "-"}
                          </TableCell>

                          <TableCell>
                            {user.email ||
                              "-"}
                          </TableCell>

                          <TableCell>
                            <Chip
                              label={
                                user.role ===
                                "admin"
                                  ? "Administrator"
                                  : "User"
                              }
                              color={
                                user.role ===
                                "admin"
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
                      )
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* =========================================================
          CREATE USER DIALOG
          ========================================================= */}
      <Dialog
        open={userDialogOpen}
        onClose={closeUserDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Create System User
        </DialogTitle>

        <DialogContent>
          <Stack
            spacing={2}
            sx={{ mt: 1 }}
          >
            <TextField
              fullWidth
              label="Username"
              value={
                newUser.username
              }
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
              value={
                newUser.full_name
              }
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
              value={
                newUser.email
              }
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
              value={
                newUser.cellphone
              }
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
              value={
                newUser.password
              }
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
              value={
                newUser.role
              }
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
            onClick={
              closeUserDialog
            }
            disabled={
              creatingUser
            }
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={
              handleCreateUser
            }
            disabled={
              creatingUser
            }
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