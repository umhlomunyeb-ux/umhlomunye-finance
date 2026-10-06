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
    const minimum = Number(
      settings.minimum_loan_amount
    );

    const maximum = Number(
      settings.maximum_loan_amount
    );

    const tier1Max = Number(
      settings.tier_1_max_amount
    );

    const tier1Rate = Number(
      settings.tier_1_interest_rate
    );

    const tier2Rate = Number(
      settings.tier_2_interest_rate
    );

    const term1Max = Number(
      settings.term_1_max_amount
    );

    const term1Months = Number(
      settings.term_1_months
    );

    const term2Max = Number(
      settings.term_2_max_amount
    );

    const term2Months = Number(
      settings.term_2_months
    );

    const term3Months = Number(
      settings.term_3_months
    );

    const maxTerm = Number(
      settings.maximum_loan_term_months
    );

    const cycleDays = Number(
      settings.interest_cycle_days
    );

    const cycleEnabled =
      settings.interest_cycle_enabled;

    const cycleTime =
      settings.interest_cycle_time;

    const timezone =
      settings.timezone;

    if (
      !settings.company_name?.trim()
    ) {
      return "Company name is required.";
    }

    if (
      !Number.isFinite(minimum) ||
      minimum <= 0
    ) {
      return "Minimum loan amount must be greater than zero.";
    }

    if (
      !Number.isFinite(maximum) ||
      maximum <= minimum
    ) {
      return "Maximum loan amount must be greater than minimum loan amount.";
    }

    if (
      !Number.isFinite(tier1Max) ||
      tier1Max < minimum ||
      tier1Max > maximum
    ) {
      return "Tier 1 maximum must be between the minimum and maximum loan amounts.";
    }

    if (
      !Number.isFinite(tier1Rate) ||
      tier1Rate < 0 ||
      tier1Rate > 100
    ) {
      return "Tier 1 interest rate must be between 0% and 100%.";
    }

    if (
      !Number.isFinite(tier2Rate) ||
      tier2Rate < 0 ||
      tier2Rate > 100
    ) {
      return "Tier 2 interest rate must be between 0% and 100%.";
    }

    if (
      !Number.isFinite(term1Max) ||
      term1Max < minimum ||
      term1Max > maximum
    ) {
      return "Term 1 maximum amount must be between the minimum and maximum loan amounts.";
    }

    if (
      !Number.isFinite(term1Months) ||
      term1Months <= 0
    ) {
      return "Term 1 must be greater than zero months.";
    }

    if (
      !Number.isFinite(term2Max) ||
      term2Max <= term1Max ||
      term2Max > maximum
    ) {
      return "Term 2 maximum amount must be greater than Term 1 maximum and not exceed the maximum loan amount.";
    }

    if (
      !Number.isFinite(term2Months) ||
      term2Months <= term1Months
    ) {
      return "Term 2 must be greater than Term 1.";
    }

    if (
      !Number.isFinite(term3Months) ||
      term3Months < term2Months
    ) {
      return "Term 3 must be greater than or equal to Term 2.";
    }

    if (
      !Number.isFinite(maxTerm) ||
      maxTerm <= 0
    ) {
      return "Maximum loan term must be greater than zero.";
    }

    if (term1Months > maxTerm) {
      return "Term 1 cannot exceed the maximum loan term.";
    }

    if (term2Months > maxTerm) {
      return "Term 2 cannot exceed the maximum loan term.";
    }

    if (term3Months > maxTerm) {
      return "Term 3 cannot exceed the maximum loan term.";
    }

    if (
      typeof cycleEnabled !== "boolean"
    ) {
      return "Interest cycle enabled setting is invalid.";
    }

    if (cycleEnabled) {
      if (
        !Number.isFinite(cycleDays) ||
        cycleDays <= 0
      ) {
        return "Interest cycle must be greater than zero days.";
      }

      if (
        typeof cycleTime !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(
          cycleTime
        )
      ) {
        return "Interest cycle time must be a valid time in HH:MM format.";
      }
    }

    if (
      typeof timezone !== "string" ||
      !timezone.trim()
    ) {
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
          MOBILE APP SETUP
          ========================================================= */}
      {isAdmin && (
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
              sx={{ mb: 2 }}
            >
              <Box>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  <SmartphoneIcon />

                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    Browser Mobile Pairing
                  </Typography>
                </Stack>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  Connect the generic LMS Companion app to
                  this LMS installation.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                startIcon={
                  <RefreshIcon />
                }
                onClick={
                  loadMobileDevices
                }
                disabled={
                  loadingMobileDevices
                }
              >
                {loadingMobileDevices
                  ? "Refreshing..."
                  : "Refresh Devices"}
              </Button>
            </Stack>

            <Alert
              severity="info"
              sx={{ mb: 3 }}
            >
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ mb: 0.5 }}
              >
                This mobile app is paired to this LMS
                installation.
              </Typography>

              <Typography variant="body2">
                Pairing does not replace user login. After a
                phone is paired, the user must still sign in
                using their normal LMS username and password.
              </Typography>
            </Alert>

            {/* SYSTEM IDENTITY — MOBILE SETUP ONLY */}
            <Grid
              container
              spacing={2}
              sx={{ mb: 3 }}
            >
              <Grid
                size={{
                  xs: 12,
                  md: 6,
                }}
              >
                <TextField
                  fullWidth
                  label="System Name"
                  value={
                    settings.system_name ||
                    ""
                  }
                  InputProps={{
                    readOnly: true,
                  }}
                  helperText="Automatically generated from Company Name."
                />
              </Grid>

              <Grid
                size={{
                  xs: 12,
                  md: 6,
                }}
              >
                <TextField
                  fullWidth
                  label="Mobile App Name"
                  value={
                    settings.mobile_app_name ||
                    ""
                  }
                  InputProps={{
                    readOnly: true,
                  }}
                  helperText="Automatically generated from Short Name."
                />
              </Grid>
            </Grid>

            {/* GENERATE PAIRING */}
            <Card
              variant="outlined"
              sx={{ mb: 3 }}
            >
              <CardContent>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mb: 1 }}
                >
                  <QrCode2Icon />

                  <Typography
                    variant="subtitle1"
                    fontWeight={700}
                  >
                    Generate Mobile Pairing
                  </Typography>
                </Stack>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2 }}
                >
                  Generate a temporary secure browser pairing credential.
                  The QR code and numeric code expire automatically
                  and can be regenerated at any time.
                </Typography>

                <Button
                  variant="contained"
                  startIcon={
                    <QrCode2Icon />
                  }
                  onClick={
                    handleGenerateMobilePairing
                  }
                  disabled={
                    creatingPairing
                  }
                >
                  {creatingPairing
                    ? "Generating..."
                    : "Generate Pairing"}
                </Button>

                {pairingResult && (
                  <Box sx={{ mt: 3 }}>
                    <Alert
                      severity={
                        pairingSecondsRemaining > 0
                          ? "success"
                          : "warning"
                      }
                      sx={{ mb: 3 }}
                    >
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        sx={{ mb: 0.5 }}
                      >
                        {pairingSecondsRemaining > 0
                          ? "Pairing credential ready."
                          : "This pairing credential has expired."}
                      </Typography>

                      <Typography variant="body2">
                        Installation ID:{" "}
                        {pairingResult.installation_id ||
                          "-"}
                      </Typography>

                      <Typography variant="body2">
                        Expires:{" "}
                        {formatDateTime(
                          pairingResult.expires_at
                        )}
                      </Typography>

                      <Typography variant="body2">
                        Time remaining:{" "}
                        <strong>
                          {formatCountdown(
                            pairingSecondsRemaining
                          )}
                        </strong>
                      </Typography>
                    </Alert>

                    <Grid
                      container
                      spacing={3}
                      alignItems="center"
                    >
                      {/* QR */}
                      <Grid
                        size={{
                          xs: 12,
                          md: 5,
                        }}
                      >
                        <Stack
                          alignItems="center"
                          spacing={2}
                        >
                          {pairingQrCode ? (
                            <Box
                              sx={{
                                p: 2,
                                border: "1px solid",
                                borderColor:
                                  "divider",
                                borderRadius: 2,
                                backgroundColor:
                                  "white",
                                display:
                                  "inline-flex",
                              }}
                            >
                              <img
                                src={
                                  pairingQrCode
                                }
                                alt="Browser mobile pairing QR code"
                                style={{
                                  width: 280,
                                  height: 280,
                                  display:
                                    "block",
                                }}
                              />
                            </Box>
                          ) : (
                            <CircularProgress />
                          )}

                          <Typography
                            variant="caption"
                            color="text.secondary"
                            textAlign="center"
                          >
                            Scan this QR code with the phone's
                             normal camera. The link will open
                             the LMS in the browser and pair it
                             automatically.
                          </Typography>
                        </Stack>
                      </Grid>

                      {/* NUMERIC CODE */}
                      <Grid
                        size={{
                          xs: 12,
                          md: 7,
                        }}
                      >
                        <Stack
                          spacing={2}
                        >
                          <Box>
                            <Typography
                              variant="subtitle2"
                              fontWeight={700}
                            >
                              Numeric Fallback Code
                            </Typography>

                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              If QR scanning is unavailable,
                              enter this code in LMS Companion.
                            </Typography>
                          </Box>

                          <Box
                            sx={{
                              border: "1px solid",
                              borderColor:
                                "divider",
                              borderRadius: 2,
                              p: 3,
                              textAlign:
                                "center",
                              backgroundColor:
                                "action.hover",
                            }}
                          >
                            <Typography
                              variant="h3"
                              fontWeight={800}
                              letterSpacing={4}
                            >
                              {pairingResult.numeric_code ||
                                "--------"}
                            </Typography>
                          </Box>

                          <Alert severity="warning">
                            <Typography variant="body2">
                              This code is temporary. Do not
                              share it publicly. Generate a new
                              pairing if the code is exposed or
                              the pairing attempt is no longer
                              trusted.
                            </Typography>
                          </Alert>
                        </Stack>
                      </Grid>
                    </Grid>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* PAIRING INSTRUCTIONS */}
            <Card
              variant="outlined"
              sx={{ mb: 3 }}
            >
              <CardContent>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ mb: 2 }}
                >
                  Pairing Instructions
                </Typography>

                <Stack spacing={1}>
                  <Typography variant="body2">
                    <strong>1.</strong> Install and open the
                    generic <strong>LMS Companion</strong> app.
                  </Typography>

                  <Typography variant="body2">
                    <strong>2.</strong> Choose{" "}
                    <strong>Scan QR Code</strong> or enter the
                    temporary numeric pairing code.
                  </Typography>

                  <Typography variant="body2">
                    <strong>3.</strong> The app connects the
                    device to this LMS installation.
                  </Typography>

                  <Typography variant="body2">
                    <strong>4.</strong> After pairing, sign in
                    using the normal LMS user credentials.
                  </Typography>

                  <Typography variant="body2">
                    <strong>5.</strong> The phone can then
                    receive notifications from this LMS
                    installation according to the user's
                    permissions.
                  </Typography>
                </Stack>
              </CardContent>
            </Card>

            {/* CONNECTED DEVICES */}
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
              sx={{ mb: 2 }}
            >
              <Box>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  <DevicesIcon />

                  <Typography
                    variant="subtitle1"
                    fontWeight={700}
                  >
                    Connected Devices
                  </Typography>
                </Stack>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Manage phones and other mobile devices
                  paired to this LMS installation.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                color="error"
                startIcon={
                  <DeleteIcon />
                }
                onClick={
                  handleRevokeAllMobileDevices
                }
                disabled={
                  revokingAllDevices ||
                  mobileDevices.length === 0
                }
              >
                {revokingAllDevices
                  ? "Revoking..."
                  : "Revoke All Devices"}
              </Button>
            </Stack>

            {loadingMobileDevices ? (
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
            ) : mobileDevices.length === 0 ? (
              <Alert severity="info">
                No mobile devices are currently connected
                to this LMS installation.
              </Alert>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        Device
                      </TableCell>

                      <TableCell>
                        Platform
                      </TableCell>

                      <TableCell>
                        App Version
                      </TableCell>

                      <TableCell>
                        Paired
                      </TableCell>

                      <TableCell>
                        Last Seen
                      </TableCell>

                      <TableCell>
                        Push
                      </TableCell>

                      <TableCell>
                        Status
                      </TableCell>

                      <TableCell align="right">
                        Action
                      </TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {mobileDevices.map(
                      (device) => {
                        const pushStatus =
                          getPushStatus(
                            device
                          );

                        const deviceStatus =
                          getDeviceStatus(
                            device
                          );

                        return (
                          <TableRow
                            key={
                              device.id
                            }
                          >
                            <TableCell>
                              <Typography
                                variant="body2"
                                fontWeight={600}
                              >
                                {device.device_name ||
                                  "Unknown device"}
                              </Typography>

                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {device.device_id ||
                                  "-"}
                              </Typography>
                            </TableCell>

                            <TableCell>
                              {device.platform ||
                                "-"}
                            </TableCell>

                            <TableCell>
                              {device.app_version ||
                                "-"}
                            </TableCell>

                            <TableCell>
                              {formatDateTime(
                                device.paired_at
                              )}
                            </TableCell>

                            <TableCell>
                              {formatDateTime(
                                device.last_seen_at
                              )}
                            </TableCell>

                            <TableCell>
                              <Chip
                                label={
                                  pushStatus.label
                                }
                                color={
                                  pushStatus.color
                                }
                                size="small"
                              />
                            </TableCell>

                            <TableCell>
                              <Chip
                                label={
                                  deviceStatus.label
                                }
                                color={
                                  deviceStatus.color
                                }
                                size="small"
                              />
                            </TableCell>

                            <TableCell align="right">
                              {!device.revoked_at && (
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  startIcon={
                                    <DeleteIcon />
                                  }
                                  onClick={() =>
                                    handleRevokeMobileDevice(
                                      device.id
                                    )
                                  }
                                  disabled={
                                    revokingDeviceId ===
                                    device.id
                                  }
                                >
                                  {revokingDeviceId ===
                                  device.id
                                    ? "Revoking..."
                                    : "Revoke"}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      }
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* =========================================================
          LOAN RULES
          ========================================================= */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography
            variant="h6"
            fontWeight={700}
          >
            Loan Rules
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            These rules determine the pricing and term of new loans.
          </Typography>

          {settings &&
            settings.tier_1_max_amount != null &&
            settings.tier_1_interest_rate != null &&
            settings.tier_2_interest_rate != null && (
              <Alert
                severity="info"
                sx={{ mb: 3 }}
              >
                <strong>
                  Current loan pricing:
                </strong>{" "}
                Loans up to R
                {Number(
                  settings.tier_1_max_amount
                ).toLocaleString(
                  "en-ZA"
                )}{" "}
                use{" "}
                {settings.tier_1_interest_rate}%.
                Loans above R
                {Number(
                  settings.tier_1_max_amount
                ).toLocaleString(
                  "en-ZA"
                )}{" "}
                use{" "}
                {settings.tier_2_interest_rate}%.
              </Alert>
            )}

          <Grid
            container
            spacing={2}
          >
            {/* MINIMUM LOAN */}
            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Minimum Loan Amount"
                value={
                  settings.minimum_loan_amount
                }
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

            {/* MAXIMUM LOAN */}
            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Maximum Loan Amount"
                value={
                  settings.maximum_loan_amount
                }
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

            {/* INTEREST TIER 1 */}
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

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Tier 1 Maximum Amount"
                value={
                  settings.tier_1_max_amount
                }
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

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Tier 1 Interest Rate"
                value={
                  settings.tier_1_interest_rate
                }
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

            {/* INTEREST TIER 2 */}
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

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Tier 2 Interest Rate"
                value={
                  settings.tier_2_interest_rate
                }
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

            {/* LOAN TERM RULES */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />

              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Loan Term Rules
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                The loan term is automatically selected from
                these amount ranges when a new loan is calculated.
              </Typography>
            </Grid>

            {/* TERM 1 */}
            <Grid size={{ xs: 12 }}>
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ mb: 1 }}
              >
                Term Rule 1
              </Typography>
            </Grid>

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Term 1 Maximum Amount"
                value={
                  settings.term_1_max_amount ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "term_1_max_amount",
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

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Term 1"
                value={
                  settings.term_1_months ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "term_1_months",
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

            {/* TERM 2 */}
            <Grid size={{ xs: 12 }}>
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ mb: 1, mt: 1 }}
              >
                Term Rule 2
              </Typography>
            </Grid>

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Term 2 Maximum Amount"
                value={
                  settings.term_2_max_amount ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "term_2_max_amount",
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

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Term 2"
                value={
                  settings.term_2_months ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "term_2_months",
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

            {/* TERM 3 */}
            <Grid size={{ xs: 12 }}>
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ mb: 1, mt: 1 }}
              >
                Term Rule 3
              </Typography>
            </Grid>

            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Term 3"
                value={
                  settings.term_3_months ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "term_3_months",
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

            {/* GLOBAL MAXIMUM TERM */}
            <Grid
              size={{
                xs: 12,
                md: 6,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Maximum Loan Term"
                value={
                  settings.maximum_loan_term_months
                }
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

            {/* INTEREST CYCLE */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 2 }} />

              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Interest Cycle Rules
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Configure when interest is added to the loan
                balance. These settings are used by the loan
                interest engine.
              </Typography>
            </Grid>

            {/* ENABLE INTEREST CYCLE */}
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={
                      Boolean(
                        settings.interest_cycle_enabled
                      )
                    }
                    onChange={(e) =>
                      handleChange(
                        "interest_cycle_enabled",
                        e.target.checked
                      )
                    }
                    disabled={!isAdmin}
                  />
                }
                label="Enable Interest Cycle"
              />
            </Grid>

            {/* INTEREST CYCLE DAYS */}
            <Grid
              size={{
                xs: 12,
                md: 4,
              }}
            >
              <TextField
                fullWidth
                type="number"
                label="Interest Cycle Days"
                value={
                  settings.interest_cycle_days ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "interest_cycle_days",
                    e.target.value
                  )
                }
                disabled={
                  !isAdmin ||
                  !settings.interest_cycle_enabled
                }
                InputProps={{
                  endAdornment: (
                    <Typography sx={{ ml: 1 }}>
                      days
                    </Typography>
                  ),
                }}
              />
            </Grid>

            {/* INTEREST CYCLE TIME */}
            <Grid
              size={{
                xs: 12,
                md: 4,
              }}
            >
              <TextField
                fullWidth
                type="time"
                label="Interest Cycle Time"
                value={
                  settings.interest_cycle_time
                    ? String(
                        settings.interest_cycle_time
                      ).slice(0, 5)
                    : ""
                }
                onChange={(e) =>
                  handleChange(
                    "interest_cycle_time",
                    e.target.value
                  )
                }
                disabled={
                  !isAdmin ||
                  !settings.interest_cycle_enabled
                }
                InputLabelProps={{
                  shrink: true,
                }}
                inputProps={{
                  step: 60,
                }}
              />
            </Grid>

            {/* INTEREST CYCLE TIMEZONE */}
            <Grid
              size={{
                xs: 12,
                md: 4,
              }}
            >
              <TextField
                fullWidth
                label="Interest Cycle Timezone"
                value={
                  settings.timezone ?? ""
                }
                onChange={(e) =>
                  handleChange(
                    "timezone",
                    e.target.value
                  )
                }
                disabled={!isAdmin}
                helperText="The timezone used when calculating the interest-cycle date and time."
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          {/* CURRENT PRICING PREVIEW */}
          <Typography
            variant="subtitle1"
            fontWeight={700}
          >
            Current Pricing & Loan Rule Preview
          </Typography>

          <Stack
            spacing={1}
            sx={{ mt: 2 }}
          >
            <Typography>
              R
              {Number(
                settings.minimum_loan_amount
              ).toLocaleString()}
              {" – "}
              R
              {Number(
                settings.tier_1_max_amount
              ).toLocaleString()}
              {" → "}
              <strong>
                {settings.tier_1_interest_rate}%
              </strong>
            </Typography>

            <Typography>
              Above R
              {Number(
                settings.tier_1_max_amount
              ).toLocaleString()}
              {" → "}
              <strong>
                {settings.tier_2_interest_rate}%
              </strong>
            </Typography>

            <Typography>
              Maximum loan:{" "}
              <strong>
                R
                {Number(
                  settings.maximum_loan_amount
                ).toLocaleString()}
              </strong>
            </Typography>

            <Divider sx={{ my: 1 }} />

            <Typography>
              Term 1:{" "}
              <strong>
                up to R
                {Number(
                  settings.term_1_max_amount
                ).toLocaleString()}{" "}
                →{" "}
                {settings.term_1_months}{" "}
                {Number(
                  settings.term_1_months
                ) === 1
                  ? "month"
                  : "months"}
              </strong>
            </Typography>

            <Typography>
              Term 2:{" "}
              <strong>
                above R
                {Number(
                  settings.term_1_max_amount
                ).toLocaleString()}{" "}
                up to R
                {Number(
                  settings.term_2_max_amount
                ).toLocaleString()}{" "}
                →{" "}
                {settings.term_2_months} months
              </strong>
            </Typography>

            <Typography>
              Term 3:{" "}
              <strong>
                above R
                {Number(
                  settings.term_2_max_amount
                ).toLocaleString()}{" "}
                →{" "}
                {settings.term_3_months} months
              </strong>
            </Typography>

            <Typography>
              Maximum term:{" "}
              <strong>
                {settings.maximum_loan_term_months} months
              </strong>
            </Typography>

            <Divider sx={{ my: 1 }} />

            <Typography>
              Interest cycle:{" "}
              <strong>
                {settings.interest_cycle_enabled
                  ? "Enabled"
                  : "Disabled"}
              </strong>
            </Typography>

            {settings.interest_cycle_enabled && (
              <>
                <Typography>
                  Interest added every{" "}
                  <strong>
                    {settings.interest_cycle_days}{" "}
                    {Number(
                      settings.interest_cycle_days
                    ) === 1
                      ? "day"
                      : "days"}
                  </strong>
                </Typography>

                <Typography>
                  Interest cycle time:{" "}
                  <strong>
                    {settings.interest_cycle_time
                      ? String(
                          settings.interest_cycle_time
                        ).slice(0, 5)
                      : ""}
                  </strong>
                </Typography>

                <Typography>
                  Interest cycle timezone:{" "}
                  <strong>
                    {settings.timezone}
                  </strong>
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* =========================================================
          DOCUMENT STORAGE MANAGEMENT
          ========================================================= */}
      <StorageManagementCard
        isAdmin={isAdmin}
      />

      {/* =========================================================
          SETTINGS ACTIONS
          ========================================================= */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            spacing={2}
          >
            <Button
              variant="contained"
              size="large"
              startIcon={
                <SaveIcon />
              }
              onClick={handleSave}
              disabled={
                !isAdmin || saving
              }
            >
              {saving
                ? "Saving..."
                : "Save Settings"}
            </Button>

            <Button
              variant="outlined"
              size="large"
              startIcon={
                <RestartAltIcon />
              }
              onClick={handleReset}
              disabled={
                !isAdmin || saving
              }
            >
              Restore Defaults
            </Button>
          </Stack>
        </CardContent>
      </Card>

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