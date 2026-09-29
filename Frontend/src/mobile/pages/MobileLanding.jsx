import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import KeyIcon from "@mui/icons-material/Key";
import LoginIcon from "@mui/icons-material/Login";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SmartphoneIcon from "@mui/icons-material/Smartphone";

import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";

import { supabase } from "../../lib/supabase";

const DEVICE_ID_STORAGE_KEY =
  "lms_companion_device_id";

const INSTALLATION_ID_STORAGE_KEY =
  "lms_companion_installation_id";

const QR_SCANNER_ELEMENT_ID =
  "lms-companion-qr-reader";

function getDeviceId() {
  try {
    const existing = localStorage.getItem(
      DEVICE_ID_STORAGE_KEY
    );

    if (existing) {
      return existing;
    }

    const generated =
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `device-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;

    localStorage.setItem(
      DEVICE_ID_STORAGE_KEY,
      generated
    );

    return generated;
  } catch {
    return `device-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }
}

function saveInstallationId(installationId) {
  if (!installationId) {
    return;
  }

  try {
    localStorage.setItem(
      INSTALLATION_ID_STORAGE_KEY,
      installationId
    );
  } catch (error) {
    console.error(
      "Failed to save LMS installation ID:",
      error
    );
  }
}

function clearStoredInstallationId() {
  try {
    localStorage.removeItem(
      INSTALLATION_ID_STORAGE_KEY
    );
  } catch (error) {
    console.error(
      "Failed to clear LMS installation ID:",
      error
    );
  }
}

function getDeviceName() {
  if (typeof navigator === "undefined") {
    return "LMS Companion Device";
  }

  const userAgent = navigator.userAgent || "";

  if (/Android/i.test(userAgent)) {
    return "Android Device";
  }

  if (/iPhone/i.test(userAgent)) {
    return "iPhone";
  }

  if (/iPad/i.test(userAgent)) {
    return "iPad";
  }

  return "LMS Companion Device";
}

function getPlatform() {
  return "web";
}

function getAppVersion() {
  return "1.0.0";
}

function extractQrPayload(rawValue) {
  if (!rawValue) {
    throw new Error(
      "The QR code did not contain any data."
    );
  }

  let payload;

  try {
    payload =
      typeof rawValue === "string"
        ? JSON.parse(rawValue)
        : rawValue;
  } catch {
    throw new Error(
      "This is not a valid LMS pairing QR code."
    );
  }

  if (
    !payload ||
    payload.type !== "lms_pairing" ||
    Number(payload.version) !== 1
  ) {
    throw new Error(
      "This QR code is not a valid LMS pairing code."
    );
  }

  if (!payload.installation_id) {
    throw new Error(
      "The pairing QR code is missing the installation ID."
    );
  }

  if (!payload.pairing_token) {
    throw new Error(
      "The pairing QR code is missing the pairing token."
    );
  }

  return {
    installation_id: payload.installation_id,
    pairing_token: payload.pairing_token,
  };
}

export default function MobileLanding() {
  const navigate = useNavigate();

  const qrScannerRef = useRef(null);
  const qrScannerRunningRef = useRef(false);

  const [deviceId, setDeviceId] = useState("");
  const [deviceLinked, setDeviceLinked] =
    useState(false);
  const [deviceRevoked, setDeviceRevoked] =
    useState(false);

  const [checkingStatus, setCheckingStatus] =
    useState(true);

  const [pairing, setPairing] =
    useState(false);

  const [error, setError] = useState("");

  const [numericDialogOpen, setNumericDialogOpen] =
    useState(false);

  const [numericCode, setNumericCode] =
    useState("");

  const [qrScannerOpen, setQrScannerOpen] =
    useState(false);

  const stopQrScanner = useCallback(async () => {
    const scanner = qrScannerRef.current;

    if (!scanner) {
      return;
    }

    try {
      if (qrScannerRunningRef.current) {
        await scanner.stop();
      }
    } catch (err) {
      console.warn(
        "QR scanner stop warning:",
        err
      );
    }

    try {
      scanner.clear();
    } catch (err) {
      console.warn(
        "QR scanner clear warning:",
        err
      );
    }

    qrScannerRunningRef.current = false;
    qrScannerRef.current = null;
  }, []);

  const checkDeviceStatus = useCallback(
    async (currentDeviceId) => {
      if (!currentDeviceId) {
        return;
      }

      try {
        setCheckingStatus(true);
        setError("");

        const { data, error: rpcError } =
          await supabase.rpc(
            "get_mobile_device_status",
            {
              p_device_id: currentDeviceId,
            }
          );

        if (rpcError) {
          throw rpcError;
        }

        const status = Array.isArray(data)
          ? data[0]
          : data;

        setDeviceLinked(
          Boolean(status?.is_linked)
        );

        setDeviceRevoked(
          Boolean(status?.is_revoked)
        );

        if (
          status?.is_linked &&
          status?.installation_id
        ) {
          saveInstallationId(
            status.installation_id
          );
        }

        if (status?.is_revoked) {
          clearStoredInstallationId();
        }
      } catch (err) {
        console.error(
          "Failed to check mobile device status:",
          err
        );

        setError(
          err?.message ||
            "Unable to check this device's connection status."
        );
      } finally {
        setCheckingStatus(false);
      }
    },
    []
  );

  useEffect(() => {
    const id = getDeviceId();

    setDeviceId(id);

    checkDeviceStatus(id);
  }, [checkDeviceStatus]);

  const completeQrPairing = useCallback(
    async ({
      installationId,
      pairingToken,
    }) => {
      if (!installationId) {
        throw new Error(
          "The LMS installation ID is missing."
        );
      }

      if (!pairingToken) {
        throw new Error(
          "The pairing token is missing."
        );
      }

      if (!deviceId) {
        throw new Error(
          "Unable to identify this device."
        );
      }

      setPairing(true);
      setError("");

      try {
        const { data, error: rpcError } =
          await supabase.rpc(
            "pair_mobile_device",
            {
              p_installation_id:
                installationId,
              p_pairing_token:
                pairingToken,
              p_numeric_code: null,
              p_device_id: deviceId,
              p_device_name: getDeviceName(),
              p_platform: getPlatform(),
              p_app_version: getAppVersion(),
            }
          );

        if (rpcError) {
          throw rpcError;
        }

        const result = Array.isArray(data)
          ? data[0]
          : data;

        if (!result?.success) {
          throw new Error(
            result?.message ||
              "The device could not be paired."
          );
        }

        saveInstallationId(
          result?.installation_id ||
            installationId
        );

        await checkDeviceStatus(deviceId);
      } finally {
        setPairing(false);
      }
    },
    [checkDeviceStatus, deviceId]
  );

  useEffect(() => {
    if (!qrScannerOpen) {
      return undefined;
    }

    let cancelled = false;

    const startScanner = async () => {
      try {
        setError("");

        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error(
            "Camera access is not available in this browser."
          );
        }

        const scanner = new Html5Qrcode(
          QR_SCANNER_ELEMENT_ID
        );

        qrScannerRef.current = scanner;

        if (cancelled) {
          return;
        }

        await scanner.start(
          {
            facingMode: "environment",
          },
          {
            fps: 10,
            qrbox: {
              width: 250,
              height: 250,
            },
            aspectRatio: 1,
          },
          async (decodedText) => {
            if (cancelled) {
              return;
            }

            cancelled = true;

            try {
              await stopQrScanner();

              setQrScannerOpen(false);
              setPairing(false);

              const payload =
                extractQrPayload(decodedText);

              await completeQrPairing({
                installationId:
                  payload.installation_id,
                pairingToken:
                  payload.pairing_token,
              });
            } catch (err) {
              console.error(
                "QR pairing failed:",
                err
              );

              setQrScannerOpen(false);
              setPairing(false);

              setError(
                err?.message ||
                  "Unable to scan or use the LMS pairing QR code."
              );
            }
          },
          () => {
            /*
             * QR decode failures are expected while
             * the camera is searching. Do not display
             * an error for every unsuccessful frame.
             */
          }
        );

        qrScannerRunningRef.current = true;
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(
          "Unable to start QR scanner:",
          err
        );

        setQrScannerOpen(false);
        setPairing(false);

        const message = String(
          err?.message || ""
        ).toLowerCase();

        if (
          message.includes("permission") ||
          message.includes("notallowed")
        ) {
          setError(
            "Camera permission was denied. Please allow camera access and try again."
          );
        } else if (
          message.includes("secure context") ||
          message.includes("https")
        ) {
          setError(
            "QR scanning requires a secure HTTPS connection."
          );
        } else {
          setError(
            err?.message ||
              "Unable to access the camera for QR scanning."
          );
        }
      }
    };

    const timer = setTimeout(
      startScanner,
      100
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);

      stopQrScanner();
    };
  }, [
    completeQrPairing,
    qrScannerOpen,
    stopQrScanner,
  ]);

  const handleScanQr = () => {
    setError("");
    setPairing(true);
    setQrScannerOpen(true);
  };

  const handleCloseQrScanner = async () => {
    if (pairing) {
      return;
    }

    await stopQrScanner();

    setQrScannerOpen(false);
  };

  const handleNumericPairing = async () => {
    const cleanedCode =
      numericCode.replace(/\D/g, "");

    if (!/^\d{8}$/.test(cleanedCode)) {
      setError(
        "Enter the 8-digit temporary pairing code."
      );
      return;
    }

    if (!deviceId) {
      setError(
        "Unable to identify this device."
      );
      return;
    }

    try {
      setPairing(true);
      setError("");

      const { data, error: rpcError } =
        await supabase.rpc(
          "pair_mobile_device_by_code",
          {
            p_numeric_code: cleanedCode,
            p_device_id: deviceId,
            p_device_name: getDeviceName(),
            p_platform: getPlatform(),
            p_app_version: getAppVersion(),
          }
        );

      if (rpcError) {
        throw rpcError;
      }

      const result = Array.isArray(data)
        ? data[0]
        : data;

      if (!result?.success) {
        throw new Error(
          result?.message ||
            "The pairing code is invalid, expired, or could not be used."
        );
      }

      if (result?.installation_id) {
        saveInstallationId(
          result.installation_id
        );
      }

      setNumericDialogOpen(false);
      setNumericCode("");

      await checkDeviceStatus(deviceId);
    } catch (err) {
      console.error(
        "Numeric pairing failed:",
        err
      );

      setError(
        err?.message ||
          "The pairing code is invalid, expired, or could not be used."
      );
    } finally {
      setPairing(false);
    }
  };

  const handleOpenNumericDialog = () => {
    setError("");
    setNumericCode("");
    setNumericDialogOpen(true);
  };

  const handleLogin = () => {
    navigate("/login");
  };

  if (checkingStatus) {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#f5f7fa",
          px: 3,
        }}
      >
        <Stack
          spacing={2}
          alignItems="center"
        >
          <CircularProgress />

          <Typography color="text.secondary">
            Checking device connection...
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (deviceLinked) {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          bgcolor: "#f5f7fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 2,
          py: 4,
        }}
      >
        <Card
          sx={{
            width: "100%",
            maxWidth: 430,
            borderRadius: 3,
            boxShadow: 3,
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Stack
              spacing={3}
              alignItems="center"
            >
              <Box
                sx={{
                  width: 76,
                  height: 76,
                  borderRadius: "50%",
                  bgcolor: "success.main",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <SmartphoneIcon
                  sx={{ fontSize: 40 }}
                />
              </Box>

              <Stack
                spacing={1}
                alignItems="center"
              >
                <Typography
                  variant="h5"
                  fontWeight={700}
                  sx={{ textAlign: "center" }}
                >
                  Device Connected
                </Typography>

                <Typography
                  color="text.secondary"
                  sx={{ textAlign: "center" }}
                >
                  This device is linked to an LMS
                  installation.
                </Typography>
              </Stack>

              <Divider flexItem />

              <Button
                fullWidth
                variant="contained"
                size="large"
                startIcon={<LoginIcon />}
                onClick={handleLogin}
                sx={{
                  py: 1.5,
                  borderRadius: 2,
                  textTransform: "none",
                  fontWeight: 700,
                }}
              >
                Login
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <>
      <Box
        sx={{
          minHeight: "100dvh",
          bgcolor: "#f5f7fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 2,
          py: 4,
        }}
      >
        <Card
          sx={{
            width: "100%",
            maxWidth: 430,
            borderRadius: 3,
            boxShadow: 3,
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={3}>
              <Stack
                spacing={1}
                alignItems="center"
              >
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: 3,
                    bgcolor: "#0b1f3a",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <SmartphoneIcon
                    sx={{ fontSize: 38 }}
                  />
                </Box>

                <Typography
                  variant="h5"
                  fontWeight={700}
                  sx={{
                    mt: 1,
                    textAlign: "center",
                  }}
                >
                  LMS Companion
                </Typography>

                <Typography
                  color="text.secondary"
                  sx={{ textAlign: "center" }}
                >
                  Connect this device to your LMS
                  installation
                </Typography>
              </Stack>

              {deviceRevoked && (
                <Alert
                  severity="warning"
                  icon={<LinkOffIcon />}
                >
                  This device is no longer linked.
                  Please pair this device again.
                </Alert>
              )}

              {error && (
                <Alert severity="error">
                  {error}
                </Alert>
              )}

              <Stack spacing={2}>
                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  startIcon={
                    pairing ? (
                      <CircularProgress
                        size={20}
                        color="inherit"
                      />
                    ) : (
                      <QrCodeScannerIcon />
                    )
                  }
                  onClick={handleScanQr}
                  disabled={pairing}
                  sx={{
                    py: 1.5,
                    borderRadius: 2,
                    textTransform: "none",
                    fontWeight: 700,
                  }}
                >
                  {pairing
                    ? "Pairing..."
                    : "Scan QR Code"}
                </Button>

                <Button
                  fullWidth
                  variant="outlined"
                  size="large"
                  startIcon={<KeyIcon />}
                  onClick={
                    handleOpenNumericDialog
                  }
                  disabled={pairing}
                  sx={{
                    py: 1.5,
                    borderRadius: 2,
                    textTransform: "none",
                    fontWeight: 700,
                  }}
                >
                  Enter Numeric Code
                </Button>
              </Stack>

              <Divider />

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: "center" }}
              >
                Generate a temporary pairing
                credential from the Mobile App
                Setup section of your LMS Settings.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Dialog
        open={qrScannerOpen}
        onClose={handleCloseQrScanner}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Scan LMS Pairing QR Code
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center" }}
            >
              Allow camera access, then position
              the LMS pairing QR code inside the
              scanning area.
            </Typography>

            <Box
              id={QR_SCANNER_ELEMENT_ID}
              sx={{
                width: "100%",
                minHeight: 300,
                overflow: "hidden",
                borderRadius: 2,
                "& video": {
                  width: "100% !important",
                  height: "auto !important",
                  borderRadius: 2,
                },
                "& img": {
                  maxWidth: "100%",
                },
              }}
            />

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: "center" }}
            >
              QR scanning uses this device's
              browser camera.
            </Typography>
          </Stack>
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            pb: 2,
          }}
        >
          <Button
            onClick={handleCloseQrScanner}
            disabled={pairing}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={numericDialogOpen}
        onClose={() => {
          if (!pairing) {
            setNumericDialogOpen(false);
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          Enter Pairing Code
        </DialogTitle>

        <DialogContent>
          <Stack
            spacing={2}
            sx={{ pt: 1 }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Enter the temporary 8-digit code
              generated by the LMS administrator.
            </Typography>

            <TextField
              autoFocus
              fullWidth
              label="8-digit pairing code"
              value={numericCode}
              onChange={(event) => {
                const value =
                  event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 8);

                setNumericCode(value);
              }}
              inputProps={{
                inputMode: "numeric",
                maxLength: 8,
              }}
              disabled={pairing}
            />
          </Stack>
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            pb: 2,
          }}
        >
          <Button
            onClick={() =>
              setNumericDialogOpen(false)
            }
            disabled={pairing}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleNumericPairing}
            disabled={
              pairing ||
              !/^\d{8}$/.test(numericCode)
            }
          >
            Pair Device
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
