import { useEffect, useState } from "react";

import {
  addLoanApplication,
  uploadPublicApplicationDocument,
} from "../../services/applicationService";

import { supabase } from "../../lib/supabase";

import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  MenuItem,
  Divider,
  Alert,
  IconButton,
  Select,
  FormControl,
  InputLabel,
  CircularProgress,
  Chip,
} from "@mui/material";

import DeleteIcon from "@mui/icons-material/Delete";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

const DOCUMENT_TYPES = [
  "ID Document",
  "Bank Statement",
  "Payslip",
  "Proof of Residence",
  "Other",
];

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  cellphone: "",
  email: "",
  physical_address: "",
  employer: "",
  employment_status: "",
  monthly_income: "",
  other_income: "",
  bank_name: "",
  account_number: "",
  amount_requested: "",
  loan_purpose: "",
  preferred_payment_date: "",
  collection_preference: "",
  notes: "",
  id_number: "",
};

export default function PublicApplication() {
  const [companyName, setCompanyName] = useState("Company");

  const [idNumber, setIdNumber] = useState("");

  const [checkingId, setCheckingId] = useState(false);
  const [idChecked, setIdChecked] = useState(false);
  const [existingCustomer, setExistingCustomer] =
    useState(false);

  const [customerNumber, setCustomerNumber] =
    useState("");

  const [submitted, setSubmitted] = useState(false);

  const [applicationNumber, setApplicationNumber] =
    useState("");

  const [applicationId, setApplicationId] =
    useState("");

  const [uploadToken, setUploadToken] =
    useState("");

  const [loading, setLoading] = useState(false);

  const [uploading, setUploading] =
    useState(false);

  const [error, setError] = useState("");

  const [idMessage, setIdMessage] =
    useState("");

  const [uploadMessage, setUploadMessage] =
    useState("");

  const [uploadErrors, setUploadErrors] =
    useState([]);

  const [documents, setDocuments] =
    useState([]);

  const [form, setForm] =
    useState(EMPTY_FORM);

  useEffect(() => {
    loadCompanySettings();
  }, []);

  async function loadCompanySettings() {
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select("company_name")
        .maybeSingle();

      if (error) {
        console.error(
          "LOAD COMPANY SETTINGS ERROR:",
          error
        );
        return;
      }

      if (data?.company_name) {
        setCompanyName(data.company_name);
      }
    } catch (err) {
      console.error(
        "LOAD COMPANY SETTINGS ERROR:",
        err
      );
    }
  }

  function normalizeId(value) {
    return String(value || "")
      .replace(/\D/g, "")
      .slice(0, 13);
  }

  function handleIdChange(event) {
    const value = normalizeId(event.target.value);

    setIdNumber(value);

    setIdChecked(false);
    setExistingCustomer(false);
    setCustomerNumber("");
    setIdMessage("");
    setError("");

    setForm((previous) => ({
      ...previous,
      id_number: value,
    }));
  }

  async function handleCheckId() {
    setError("");
    setIdMessage("");

    const normalizedId =
      normalizeId(idNumber);

    if (normalizedId.length !== 13) {
      setError(
        "Please enter a valid 13-digit South African ID number."
      );
      return;
    }

    try {
      setCheckingId(true);

      const {
        data,
        error: lookupError,
      } = await supabase.rpc(
        "lookup_public_customer_by_id_number",
        {
          p_id_number: normalizedId,
        }
      );

      if (lookupError) {
        throw lookupError;
      }

      const customer =
        Array.isArray(data)
          ? data[0] || null
          : data || null;

      setIdChecked(true);

      if (customer) {
        setExistingCustomer(true);

        setCustomerNumber(
          customer.customer_number || ""
        );

        setForm({
          ...EMPTY_FORM,

          id_number:
            normalizedId,

          first_name:
            customer.first_name || "",

          last_name:
            customer.last_name || "",

          cellphone:
            customer.cellphone || "",

          email:
            customer.email || "",

          physical_address:
            customer.physical_address || "",

          employer:
            customer.employer || "",

          employment_status:
            customer.employment_status || "",

          monthly_income:
            customer.monthly_income ??
            "",

          other_income:
            customer.other_income ??
            "",

          bank_name:
            customer.bank_name || "",

          account_number:
            customer.account_number || "",

          loan_purpose:
            customer.loan_purpose || "",

          collection_preference:
            customer.collection_preference ||
            "",

          amount_requested: "",

          preferred_payment_date: "",

          notes: "",
        });

        setIdMessage(
          "Existing customer found. Your registered information has been loaded."
        );
      } else {
        setExistingCustomer(false);
        setCustomerNumber("");

        setForm({
          ...EMPTY_FORM,
          id_number: normalizedId,
        });

        setIdMessage(
          "No existing customer was found. Please complete the application details below."
        );
      }
    } catch (err) {
      console.error(
        "PUBLIC CUSTOMER ID LOOKUP ERROR:",
        err
      );

      setIdChecked(false);
      setExistingCustomer(false);

      setError(
        err?.message ||
          "Unable to check the ID number. Please try again."
      );
    } finally {
      setCheckingId(false);
    }
  }

  function handleChange(event) {
    const {
      name,
      value,
    } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    if (name === "amount_requested") {
      setError("");
    }
  }

  function handleDocumentSelect(event) {
    const selectedFiles = Array.from(
      event.target.files || []
    );

    if (!selectedFiles.length) {
      return;
    }

    setError("");

    const remainingSlots =
      MAX_FILES - documents.length;

    if (remainingSlots <= 0) {
      setError(
        `You can upload a maximum of ${MAX_FILES} documents.`
      );

      event.target.value = "";
      return;
    }

    const filesToAdd =
      selectedFiles.slice(0, remainingSlots);

    const rejected = [];
    const validDocuments = [];

    for (const file of filesToAdd) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        rejected.push(
          `${file.name}: only PDF, JPG and PNG files are allowed.`
        );
        continue;
      }

      if (file.size <= 0) {
        rejected.push(
          `${file.name}: the file is empty.`
        );
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        rejected.push(
          `${file.name}: the maximum file size is 10 MB.`
        );
        continue;
      }

      validDocuments.push({
        id: crypto.randomUUID(),
        file,
        documentType: "Other",
      });
    }

    if (
      selectedFiles.length >
      remainingSlots
    ) {
      rejected.push(
        `Only ${remainingSlots} additional document(s) could be selected.`
      );
    }

    setDocuments((previous) => [
      ...previous,
      ...validDocuments,
    ]);

    if (rejected.length) {
      setError(rejected.join(" "));
    }

    event.target.value = "";
  }

  function removeDocument(id) {
    if (uploading) return;

    setDocuments((previous) =>
      previous.filter(
        (document) =>
          document.id !== id
      )
    );
  }

  function changeDocumentType(
    id,
    documentType
  ) {
    setDocuments((previous) =>
      previous.map((document) =>
        document.id === id
          ? {
              ...document,
              documentType,
            }
          : document
      )
    );
  }

  async function uploadDocuments(
    id,
    token
  ) {
    if (!documents.length) {
      return {
        uploaded: 0,
        failed: [],
      };
    }

    setUploading(true);

    setUploadMessage(
      `Uploading 0 of ${documents.length} documents...`
    );

    setUploadErrors([]);

    const failed = [];
    let uploaded = 0;

    for (const document of documents) {
      try {
        await uploadPublicApplicationDocument({
          applicationId: id,
          uploadToken: token,
          documentType:
            document.documentType,
          file: document.file,
        });

        uploaded += 1;

        setUploadMessage(
          `Uploading ${uploaded} of ${documents.length} documents...`
        );
      } catch (err) {
        console.error(
          "DOCUMENT UPLOAD ERROR:",
          err
        );

        failed.push(
          `${document.file.name}: ${
            err?.message ||
            "Upload failed."
          }`
        );
      }
    }

    setUploading(false);

    if (failed.length === 0) {
      setUploadMessage(
        `${uploaded} document${
          uploaded === 1 ? "" : "s"
        } uploaded successfully.`
      );
    } else {
      setUploadMessage(
        `${uploaded} of ${documents.length} documents uploaded.`
      );

      setUploadErrors(failed);
    }

    return {
      uploaded,
      failed,
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");

    if (!idChecked) {
      setError(
        "Please check your ID number before continuing."
      );
      return;
    }

    if (!form.id_number) {
      setError(
        "ID number is required."
      );
      return;
    }

    if (
      normalizeId(form.id_number).length !==
      13
    ) {
      setError(
        "Please enter a valid 13-digit South African ID number."
      );
      return;
    }

    if (!form.amount_requested) {
      setError(
        "Please enter the amount you want to borrow."
      );
      return;
    }

    const amount = Number(
      form.amount_requested
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        "Loan amount must be greater than zero."
      );
      return;
    }

    if (
      !form.preferred_payment_date
    ) {
      setError(
        "Please select your preferred payment date."
      );
      return;
    }

    if (!existingCustomer) {
      if (!form.first_name.trim()) {
        setError(
          "Please enter your first name."
        );
        return;
      }

      if (!form.last_name.trim()) {
        setError(
          "Please enter your last name."
        );
        return;
      }

      if (!form.cellphone.trim()) {
        setError(
          "Please enter your cellphone number."
        );
        return;
      }

      if (!form.bank_name.trim()) {
        setError(
          "Please enter your bank name."
        );
        return;
      }

      if (!form.account_number.trim()) {
        setError(
          "Please enter your bank account number."
        );
        return;
      }
    }

    setLoading(true);

    try {
      const data =
        await addLoanApplication({
          first_name:
            form.first_name.trim(),

          last_name:
            form.last_name.trim(),

          cellphone:
            form.cellphone.trim(),

          email:
            form.email.trim() || null,

          physical_address:
            form.physical_address.trim() ||
            null,

          employer:
            form.employer.trim() || null,

          employment_status:
            form.employment_status ||
            null,

          monthly_income:
            form.monthly_income !== ""
              ? Number(
                  form.monthly_income
                )
              : null,

          other_income:
            form.other_income !== ""
              ? Number(
                  form.other_income
                )
              : null,

          bank_name:
            form.bank_name.trim(),

          account_number:
            form.account_number.trim(),

          amount_requested:
            amount,

          loan_purpose:
            form.loan_purpose.trim() ||
            null,

          preferred_payment_date:
            form.preferred_payment_date,

          collection_preference:
            form.collection_preference ||
            null,

          notes:
            form.notes.trim() ||
            null,

          id_number:
            normalizeId(
              form.id_number
            ),
        });

      const result =
        Array.isArray(data)
          ? data[0]
          : data;

      const number =
        result?.application_number;

      const id =
        result?.application_id;

      const token =
        result?.upload_token;

      if (!id || !token) {
        throw new Error(
          "The application was submitted, but the secure document upload session could not be created."
        );
      }

      try {
        await supabase.functions.invoke(
          "send-loan-email",
          {
            body: {
              notificationType: "PENDING_REVIEW",
              applicationId: id,
              applicationNumber: number,
              clientName: `${form.first_name.trim()} ${form.last_name.trim()}`,
              amountRequested: amount,
            },
          }
        );
      } catch (emailError) {
        console.error(
          "APPLICATION REVIEW EMAIL ERROR:",
          emailError
        );
      }

      setApplicationNumber(
        number || "SUBMITTED"
      );

      setApplicationId(id);
      setUploadToken(token);

      setSubmitted(true);

      if (documents.length > 0) {
        await uploadDocuments(
          id,
          token
        );
      }
    } catch (err) {
      console.error(
        "APPLICATION SUBMISSION ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to submit application. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "#f5f7fa",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          p: 2,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            maxWidth: 650,
            width: "100%",
            p: {
              xs: 3,
              sm: 5,
            },
          }}
        >
          <Box
            sx={{
              textAlign: "center",
            }}
          >
            <CheckCircleIcon
              color="success"
              sx={{
                fontSize: 64,
                mb: 1,
              }}
            />

            <Typography
              variant="h4"
              gutterBottom
              fontWeight="bold"
            >
              Application Submitted
            </Typography>

            <Typography
              variant="h6"
              sx={{ mt: 2 }}
            >
              Application Number
            </Typography>

            <Typography
              variant="h4"
              color="primary"
              fontWeight="bold"
              sx={{ my: 2 }}
            >
              {applicationNumber}
            </Typography>

            <Typography
              color="text.secondary"
            >
              Thank you for submitting your
              loan application. Your
              application will be reviewed
              by {companyName}.
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 2 }}
            >
              Please keep your application
              number for reference.
            </Typography>

            {documents.length > 0 && (
              <Box sx={{ mt: 4 }}>
                {uploading && (
                  <Alert severity="info">
                    {uploadMessage}
                  </Alert>
                )}

                {!uploading &&
                  uploadMessage &&
                  uploadErrors.length ===
                    0 && (
                    <Alert severity="success">
                      {uploadMessage}
                    </Alert>
                  )}

                {!uploading &&
                  uploadErrors.length >
                    0 && (
                    <>
                      <Alert
                        severity="warning"
                        sx={{ mb: 1 }}
                      >
                        {uploadMessage}
                      </Alert>

                      {uploadErrors.map(
                        (
                          message,
                          index
                        ) => (
                          <Alert
                            key={index}
                            severity="error"
                            sx={{
                              mb: 1,
                              textAlign:
                                "left",
                            }}
                          >
                            {message}
                          </Alert>
                        )
                      )}
                    </>
                  )}
              </Box>
            )}

            {applicationId &&
              uploadToken &&
              documents.length ===
                0 && (
                <Alert
                  severity="info"
                  sx={{ mt: 3 }}
                >
                  No supporting documents
                  were selected.
                </Alert>
              )}
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#f5f7fa",
        py: 4,
        px: 2,
      }}
    >
      <Box
        sx={{
          maxWidth: 900,
          mx: "auto",
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: {
              xs: 2,
              sm: 4,
            },
          }}
        >
          <Typography
            variant="h4"
            fontWeight="bold"
            gutterBottom
          >
            {companyName}
          </Typography>

          <Typography
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Loan Application
          </Typography>

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 3 }}
            >
              {error}
            </Alert>
          )}

          {/* =====================================================
              STEP 1 — IDENTITY CHECK
          ===================================================== */}

          <Paper
            variant="outlined"
            sx={{
              p: 3,
              mb: 4,
              backgroundColor: "#fafafa",
            }}
          >
            <Typography
              variant="h6"
              fontWeight="bold"
              sx={{ mb: 1 }}
            >
              1. Check Your ID Number
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mb: 2 }}
            >
              Enter your 13-digit South
              African ID number first. We
              will check whether you are
              already registered.
            </Typography>

            <Grid
              container
              spacing={2}
              alignItems="center"
            >
              <Grid
                item
                xs={12}
                sm={8}
              >
                <TextField
                  fullWidth
                  required
                  label="ID Number"
                  value={idNumber}
                  onChange={
                    handleIdChange
                  }
                  inputProps={{
                    inputMode:
                      "numeric",
                    maxLength: 13,
                  }}
                  helperText={`${idNumber.length}/13 digits`}
                  disabled={checkingId}
                />
              </Grid>

              <Grid
                item
                xs={12}
                sm={4}
              >
                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  onClick={
                    handleCheckId
                  }
                  disabled={
                    checkingId ||
                    idNumber.length !==
                      13
                  }
                  startIcon={
                    checkingId ? (
                      <CircularProgress
                        size={20}
                        color="inherit"
                      />
                    ) : (
                      <SearchIcon />
                    )
                  }
                >
                  {checkingId
                    ? "Checking..."
                    : "Check ID"}
                </Button>
              </Grid>
            </Grid>

            {idChecked &&
              existingCustomer && (
                <Alert
                  severity="success"
                  icon={
                    <CheckCircleIcon />
                  }
                  sx={{ mt: 2 }}
                >
                  <strong>
                    Existing customer found.
                  </strong>

                  {customerNumber && (
                    <>
                      {" "}
                      Customer number:{" "}
                      <strong>
                        {customerNumber}
                      </strong>
                    </>
                  )}
                </Alert>
              )}

            {idChecked &&
              !existingCustomer && (
                <Alert
                  severity="info"
                  icon={<PersonAddIcon />}
                  sx={{ mt: 2 }}
                >
                  <strong>
                    New customer application.
                  </strong>{" "}
                  Please complete your
                  personal, employment and
                  banking information below.
                </Alert>
              )}

            {idMessage && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1 }}
              >
                {idMessage}
              </Typography>
            )}
          </Paper>

          {/* =====================================================
              EVERYTHING BELOW ID CHECK
          ===================================================== */}

          {idChecked && (
            <form
              onSubmit={handleSubmit}
            >
              {/* =================================================
                  PERSONAL INFORMATION
              ================================================= */}

              <Typography
                variant="h6"
                sx={{ mb: 2 }}
                fontWeight="bold"
              >
                2. Personal Information
              </Typography>

              {existingCustomer && (
                <Alert
                  severity="info"
                  sx={{ mb: 2 }}
                >
                  Your registered personal
                  information is shown below.
                  It cannot be changed from
                  the public application form.
                </Alert>
              )}

              <Grid
                container
                spacing={2}
              >
                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required={!existingCustomer}
                    label="First Name"
                    name="first_name"
                    value={
                      form.first_name
                    }
                    onChange={
                      handleChange
                    }
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>

                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required={!existingCustomer}
                    label="Last Name"
                    name="last_name"
                    value={
                      form.last_name
                    }
                    onChange={
                      handleChange
                    }
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>

                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required={!existingCustomer}
                    label="Cellphone"
                    name="cellphone"
                    value={
                      form.cellphone
                    }
                    onChange={
                      handleChange
                    }
                    inputProps={{
                      inputMode: "tel",
                    }}
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>

                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    type="email"
                    label="Email"
                    name="email"
                    value={
                      form.email
                    }
                    onChange={
                      handleChange
                    }
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label="Physical Address"
                    name="physical_address"
                    value={
                      form.physical_address
                    }
                    onChange={
                      handleChange
                    }
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>
              </Grid>

              {!existingCustomer && (
                <>
                  <Divider
                    sx={{ my: 4 }}
                  />

                  {/* =============================================
                      EMPLOYMENT
                  ============================================= */}

                  <Typography
                    variant="h6"
                    sx={{ mb: 2 }}
                    fontWeight="bold"
                  >
                    3. Employment & Income
                  </Typography>

                  <Grid
                    container
                    spacing={2}
                  >
                    <Grid
                      item
                      xs={12}
                      sm={6}
                    >
                      <TextField
                        fullWidth
                        label="Employer"
                        name="employer"
                        value={
                          form.employer
                        }
                        onChange={
                          handleChange
                        }
                      />
                    </Grid>

                    <Grid
                      item
                      xs={12}
                      sm={6}
                    >
                      <TextField
                        select
                        fullWidth
                        label="Employment Status"
                        name="employment_status"
                        value={
                          form.employment_status
                        }
                        onChange={
                          handleChange
                        }
                      >
                        <MenuItem value="EMPLOYED">
                          Employed
                        </MenuItem>

                        <MenuItem value="SELF_EMPLOYED">
                          Self Employed
                        </MenuItem>

                        <MenuItem value="UNEMPLOYED">
                          Unemployed
                        </MenuItem>

                        <MenuItem value="OTHER">
                          Other
                        </MenuItem>
                      </TextField>
                    </Grid>

                    <Grid
                      item
                      xs={12}
                      sm={6}
                    >
                      <TextField
                        fullWidth
                        type="number"
                        label="Monthly Income"
                        name="monthly_income"
                        value={
                          form.monthly_income
                        }
                        onChange={
                          handleChange
                        }
                        inputProps={{
                          min: 0,
                          step: "0.01",
                        }}
                        InputProps={{
                          startAdornment:
                            "R ",
                        }}
                      />
                    </Grid>

                    <Grid
                      item
                      xs={12}
                      sm={6}
                    >
                      <TextField
                        fullWidth
                        type="number"
                        label="Other Income"
                        name="other_income"
                        value={
                          form.other_income
                        }
                        onChange={
                          handleChange
                        }
                        inputProps={{
                          min: 0,
                          step: "0.01",
                        }}
                        InputProps={{
                          startAdornment:
                            "R ",
                        }}
                      />
                    </Grid>
                  </Grid>
                </>
              )}

              <Divider sx={{ my: 4 }} />

              {/* =================================================
                  BANKING
              ================================================= */}

              <Typography
                variant="h6"
                sx={{ mb: 1 }}
                fontWeight="bold"
              >
                {existingCustomer
                  ? "3. Registered Banking Details"
                  : "4. Banking Details"}
              </Typography>

              {existingCustomer && (
                <Alert
                  severity="info"
                  sx={{ mb: 2 }}
                >
                  Your registered banking
                  details are shown below and
                  cannot be changed from this
                  application.
                </Alert>
              )}

              <Grid
                container
                spacing={2}
              >
                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required={!existingCustomer}
                    label="Bank Name"
                    name="bank_name"
                    value={
                      form.bank_name
                    }
                    onChange={
                      handleChange
                    }
                    placeholder="e.g. Capitec Bank"
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>

                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required={!existingCustomer}
                    label="Account Number"
                    name="account_number"
                    value={
                      form.account_number
                    }
                    onChange={
                      handleChange
                    }
                    inputProps={{
                      inputMode:
                        "numeric",
                    }}
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 4 }} />

              {/* =================================================
                  LOAN INFORMATION
              ================================================= */}

              <Typography
                variant="h6"
                sx={{ mb: 2 }}
                fontWeight="bold"
              >
                {existingCustomer
                  ? "4. New Loan Request"
                  : "5. Loan Information"}
              </Typography>

              {existingCustomer && (
                <Alert
                  severity="success"
                  sx={{ mb: 2 }}
                >
                  Because you are already
                  registered, you only need to
                  enter the new loan amount and
                  preferred payment date.
                </Alert>
              )}

              <Grid
                container
                spacing={2}
              >
                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required
                    type="number"
                    label="Amount Requested"
                    name="amount_requested"
                    value={
                      form.amount_requested
                    }
                    onChange={
                      handleChange
                    }
                    inputProps={{
                      min: 0.01,
                      step: "0.01",
                    }}
                    InputProps={{
                      startAdornment:
                        "R ",
                    }}
                  />
                </Grid>

                <Grid
                  item
                  xs={12}
                  sm={6}
                >
                  <TextField
                    fullWidth
                    required
                    type="date"
                    label="Preferred Payment Date"
                    name="preferred_payment_date"
                    value={
                      form.preferred_payment_date
                    }
                    onChange={
                      handleChange
                    }
                    InputLabelProps={{
                      shrink: true,
                    }}
                    helperText="Required"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Purpose of Loan"
                    name="loan_purpose"
                    value={
                      form.loan_purpose
                    }
                    onChange={
                      handleChange
                    }
                    InputProps={{
                      readOnly:
                        existingCustomer,
                    }}
                  />
                </Grid>
              </Grid>

              {!existingCustomer && (
                <>
                  <Divider
                    sx={{ my: 4 }}
                  />

                  {/* =============================================
                      COLLECTIONS
                  ============================================= */}

                  <Typography
                    variant="h6"
                    sx={{ mb: 2 }}
                    fontWeight="bold"
                  >
                    6. Collections
                  </Typography>

                  <TextField
                    select
                    fullWidth
                    label="Preferred Collection Method"
                    name="collection_preference"
                    value={
                      form.collection_preference
                    }
                    onChange={
                      handleChange
                    }
                  >
                    <MenuItem value="DEBIT_ORDER">
                      Debit Order
                    </MenuItem>

                    <MenuItem value="BANK_TRANSFER">
                      Bank Transfer
                    </MenuItem>

                    <MenuItem value="CASH">
                      Cash
                    </MenuItem>

                    <MenuItem value="OTHER">
                      Other
                    </MenuItem>
                  </TextField>

                  <Divider
                    sx={{ my: 4 }}
                  />

                  {/* =============================================
                      NOTES
                  ============================================= */}

                  <Typography
                    variant="h6"
                    sx={{ mb: 2 }}
                    fontWeight="bold"
                  >
                    7. Additional Information
                  </Typography>

                  <TextField
                    fullWidth
                    multiline
                    rows={4}
                    label="Additional Notes"
                    name="notes"
                    value={
                      form.notes
                    }
                    onChange={
                      handleChange
                    }
                  />
                </>
              )}

              <Divider sx={{ my: 4 }} />

              {/* =================================================
                  SUPPORTING DOCUMENTS
              ================================================= */}

              <Typography
                variant="h6"
                sx={{ mb: 1 }}
                fontWeight="bold"
              >
                Supporting Documents
              </Typography>

              <Alert
                severity="info"
                sx={{ mb: 2 }}
              >
                Upload supporting documents
                such as your ID, bank
                statement, payslip or proof of
                residence. PDF, JPG and PNG
                files are accepted. Maximum{" "}
                {MAX_FILES} files, 10 MB per
                file.
              </Alert>

              <input
                id="public-application-document-upload"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                style={{
                  display: "none",
                }}
                onChange={
                  handleDocumentSelect
                }
              />

              <label htmlFor="public-application-document-upload">
                <Button
                  component="span"
                  variant="outlined"
                  startIcon={
                    <UploadFileIcon />
                  }
                  disabled={
                    loading ||
                    uploading ||
                    documents.length >=
                      MAX_FILES
                  }
                >
                  Upload Documents
                </Button>
              </label>

              {documents.length >
                0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ mb: 1 }}
                  >
                    Selected Documents{" "}
                    <Chip
                      size="small"
                      label={`${documents.length}/${MAX_FILES}`}
                    />
                  </Typography>

                  {documents.map(
                    (document) => (
                      <Paper
                        key={document.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          mb: 1,
                        }}
                      >
                        <Grid
                          container
                          spacing={1}
                          alignItems="center"
                        >
                          <Grid
                            item
                            xs={12}
                            sm={5}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                wordBreak:
                                  "break-word",
                              }}
                            >
                              {
                                document
                                  .file
                                  .name
                              }
                            </Typography>

                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {(
                                document
                                  .file
                                  .size /
                                (1024 *
                                  1024)
                              ).toFixed(
                                2
                              )}{" "}
                              MB
                            </Typography>
                          </Grid>

                          <Grid
                            item
                            xs={10}
                            sm={6}
                          >
                            <FormControl
                              fullWidth
                              size="small"
                            >
                              <InputLabel>
                                Document Type
                              </InputLabel>

                              <Select
                                value={
                                  document.documentType
                                }
                                label="Document Type"
                                onChange={(
                                  event
                                ) =>
                                  changeDocumentType(
                                    document.id,
                                    event
                                      .target
                                      .value
                                  )
                                }
                                disabled={
                                  loading ||
                                  uploading
                                }
                              >
                                {DOCUMENT_TYPES.map(
                                  (
                                    type
                                  ) => (
                                    <MenuItem
                                      key={
                                        type
                                      }
                                      value={
                                        type
                                      }
                                    >
                                      {
                                        type
                                      }
                                    </MenuItem>
                                  )
                                )}
                              </Select>
                            </FormControl>
                          </Grid>

                          <Grid
                            item
                            xs={2}
                            sm={1}
                            sx={{
                              display:
                                "flex",
                              justifyContent:
                                "center",
                            }}
                          >
                            <IconButton
                              color="error"
                              onClick={() =>
                                removeDocument(
                                  document.id
                                )
                              }
                              disabled={
                                loading ||
                                uploading
                              }
                              aria-label={`Remove ${document.file.name}`}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Grid>
                        </Grid>
                      </Paper>
                    )
                  )}
                </Box>
              )}

              {/* =================================================
                  SUBMIT
              ================================================= */}

              <Box
                sx={{
                  mt: 4,
                  display: "flex",
                  justifyContent:
                    "flex-end",
                }}
              >
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={
                    loading ||
                    uploading ||
                    !idChecked
                  }
                >
                  {loading
                    ? "Submitting..."
                    : "Submit Application"}
                </Button>
              </Box>
            </form>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
