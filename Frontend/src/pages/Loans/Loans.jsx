import { useState } from "react";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Typography,
  Box,
  CircularProgress,
  Divider,
  Chip,
  FormControlLabel,
  Checkbox,
  Grid,
  MenuItem,
} from "@mui/material";

import LoanToolbar from "../../components/loans/LoanToolbar";
import LoanTable from "../../components/loans/LoanTable";
import LoanForm from "./LoanForm";

import {
  findCustomerByIdNumber,
  addCustomer,
  generateCustomerNumber,
} from "../../services/customerService";

import {
  getLatestReusableCustomerDocument,
  getCustomerDocuments,
  uploadDocument,
  DOCUMENT_TYPES,
  DOCUMENT_CATEGORIES,
} from "../../services/documentService";

export default function Loans() {
  const [open, setOpen] = useState(false);

  const [idCheckOpen, setIdCheckOpen] = useState(false);

  const [createCustomerOpen, setCreateCustomerOpen] =
    useState(false);

  const [idNumber, setIdNumber] = useState("");

  const [verifiedCustomer, setVerifiedCustomer] =
    useState(null);

  const [checkingCustomer, setCheckingCustomer] =
    useState(false);

  const [idCheckError, setIdCheckError] =
    useState("");

  const [customerNotFound, setCustomerNotFound] =
    useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");

  const [checkingDocuments, setCheckingDocuments] =
    useState(false);

  const [documentStatus, setDocumentStatus] =
    useState(null);

  const [documentCheckError, setDocumentCheckError] =
    useState("");

  // Unchecked by default.
  // When checked, ALL customer document checks are skipped.
  const [skipDocumentCheck, setSkipDocumentCheck] =
    useState(false);

  /*
   * When checked, a valid Bank Statement can satisfy
   * the Proof of Residence requirement.
   */
  const [
    useBankStatementAsProofOfResidence,
    setUseBankStatementAsProofOfResidence,
  ] = useState(false);

  const [uploadingDocument, setUploadingDocument] =
    useState("");

  const [selectedFiles, setSelectedFiles] = useState({
    idDocument: null,
    bankStatement: null,
    payslip: null,
    proofOfResidence: null,
  });

  /*
   * ---------------------------------------------------------
   * NEW CUSTOMER FORM
   * ---------------------------------------------------------
   */

  const [creatingCustomer, setCreatingCustomer] =
    useState(false);

  const [createCustomerError, setCreateCustomerError] =
    useState("");

  const [newCustomer, setNewCustomer] = useState({
    first_name: "",
    last_name: "",
    id_number: "",
    cellphone: "",
    email: "",
    date_of_birth: "",
    gender: "",
    employer: "",
    occupation: "",
    monthly_income: "",
    physical_address: "",
    postal_address: "",
    alternative_phone: "",
  });

  /*
   * ---------------------------------------------------------
   * RESET
   * ---------------------------------------------------------
   */

  function resetLoanStartState() {
    setIdNumber("");
    setVerifiedCustomer(null);
    setIdCheckError("");
    setCustomerNotFound(false);
    setDocumentCheckError("");
    setSkipDocumentCheck(false);

    setUseBankStatementAsProofOfResidence(false);

    setUploadingDocument("");

    setSelectedFiles({
      idDocument: null,
      bankStatement: null,
      payslip: null,
      proofOfResidence: null,
    });

    setDocumentStatus(null);

    setCreateCustomerError("");

    setNewCustomer({
      first_name: "",
      last_name: "",
      id_number: "",
      cellphone: "",
      email: "",
      date_of_birth: "",
      gender: "",
      employer: "",
      occupation: "",
      monthly_income: "",
      physical_address: "",
      postal_address: "",
      alternative_phone: "",
    });
  }

  /*
   * ---------------------------------------------------------
   * NEW LOAN
   * ---------------------------------------------------------
   */

  function handleNewLoan() {
    resetLoanStartState();
    setIdCheckOpen(true);
  }

  /*
   * ---------------------------------------------------------
   * FIND PERMANENT ID DOCUMENT
   * ---------------------------------------------------------
   */

  function findValidIdDocument(documents) {
    if (!Array.isArray(documents)) {
      return null;
    }

    const idDocuments = documents
      .filter(
        (document) =>
          document?.document_type === "ID Document" &&
          !document?.is_archived
      )
      .sort((a, b) => {
        const dateA = new Date(
          a?.created_at || 0
        ).getTime();

        const dateB = new Date(
          b?.created_at || 0
        ).getTime();

        return dateB - dateA;
      });

    return idDocuments[0] || null;
  }

  /*
   * ---------------------------------------------------------
   * DOCUMENT CHECK
   * ---------------------------------------------------------
   */

  async function checkCustomerDocuments(customer) {
    if (!customer?.id) {
      return;
    }

    try {
      setCheckingDocuments(true);
      setDocumentCheckError("");
      setDocumentStatus(null);

      const [
        customerDocuments,
        bankStatement,
        payslip,
        proofOfResidence,
      ] = await Promise.all([
        getCustomerDocuments(customer.id),

        getLatestReusableCustomerDocument(
          customer.id,
          DOCUMENT_TYPES.BANK_STATEMENT
        ),

        getLatestReusableCustomerDocument(
          customer.id,
          DOCUMENT_TYPES.PAYSLIP
        ),

        getLatestReusableCustomerDocument(
          customer.id,
          DOCUMENT_TYPES.PROOF_OF_RESIDENCE
        ),
      ]);

      const idDocument =
        findValidIdDocument(customerDocuments);

      setDocumentStatus({
        idDocument,
        bankStatement,
        payslip,
        proofOfResidence,
      });
    } catch (err) {
      console.error(
        "Customer document validation error:",
        err
      );

      setDocumentCheckError(
        err?.message ||
          "Unable to check the customer's documents."
      );

      setDocumentStatus(null);
    } finally {
      setCheckingDocuments(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * ID CHECK
   * ---------------------------------------------------------
   */

  async function handleCheckIdNumber() {
    const cleanIdNumber = idNumber.trim();

    if (checkingCustomer || checkingDocuments) {
      return;
    }

    try {
      setIdCheckError("");
      setDocumentCheckError("");
      setDocumentStatus(null);

      setCustomerNotFound(false);
      setVerifiedCustomer(null);

      if (!cleanIdNumber) {
        setIdCheckError(
          "Please enter the customer's ID number."
        );
        return;
      }

      setCheckingCustomer(true);

      const customer =
        await findCustomerByIdNumber(
          cleanIdNumber
        );

      /*
       * =====================================================
       * CUSTOMER NOT FOUND
       * =====================================================
       */

      if (!customer) {
        setVerifiedCustomer(null);

        setNewCustomer((previous) => ({
          ...previous,
          id_number: cleanIdNumber,
        }));

        setCustomerNotFound(true);

        setIdCheckError(
          "No customer with this ID number was found."
        );

        return;
      }

      /*
       * =====================================================
       * CUSTOMER FOUND
       * =====================================================
       */

      setCustomerNotFound(false);
      setIdCheckError("");
      setVerifiedCustomer(customer);

      if (!skipDocumentCheck) {
        await checkCustomerDocuments(customer);
      }
    } catch (err) {
      console.error(
        "Customer ID verification error:",
        err
      );

      setCustomerNotFound(false);

      setIdCheckError(
        err?.message ||
          "Unable to check the customer's ID number."
      );
    } finally {
      setCheckingCustomer(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * OPEN CREATE CUSTOMER
   * ---------------------------------------------------------
   */

  function handleOpenCreateCustomer() {
    setCreateCustomerError("");

    setNewCustomer((previous) => ({
      ...previous,
      id_number: idNumber.trim(),
    }));

    setCreateCustomerOpen(true);
  }

  /*
   * ---------------------------------------------------------
   * CUSTOMER FORM FIELD CHANGE
   * ---------------------------------------------------------
   */

  function handleNewCustomerChange(
    field,
    value
  ) {
    setNewCustomer((previous) => ({
      ...previous,
      [field]: value,
    }));

    setCreateCustomerError("");
  }

  /*
   * ---------------------------------------------------------
   * CREATE CUSTOMER
   * ---------------------------------------------------------
   */

  async function handleCreateCustomer(event) {
    if (event) {
      event.preventDefault();
    }

    if (creatingCustomer) {
      return;
    }

    try {
      setCreateCustomerError("");

      const cleanIdNumber =
        newCustomer.id_number.trim();

      const firstName =
        newCustomer.first_name.trim();

      const lastName =
        newCustomer.last_name.trim();

      if (!cleanIdNumber) {
        setCreateCustomerError(
          "ID number is required."
        );
        return;
      }

      if (!firstName) {
        setCreateCustomerError(
          "First name is required."
        );
        return;
      }

      if (!lastName) {
        setCreateCustomerError(
          "Last name is required."
        );
        return;
      }

      const existingCustomer =
        await findCustomerByIdNumber(
          cleanIdNumber
        );

      if (existingCustomer) {
        setVerifiedCustomer(
          existingCustomer
        );

        setCustomerNotFound(false);

        setIdNumber(cleanIdNumber);

        setCreateCustomerOpen(false);

        setIdCheckError("");

        if (!skipDocumentCheck) {
          await checkCustomerDocuments(
            existingCustomer
          );
        }

        return;
      }

      setCreatingCustomer(true);

      const customerNumber =
        await generateCustomerNumber();

      const customerToCreate = {
        customer_number: customerNumber,

        first_name: firstName,
        last_name: lastName,
        id_number: cleanIdNumber,

        cellphone:
          newCustomer.cellphone.trim() ||
          null,

        email:
          newCustomer.email.trim() ||
          null,

        date_of_birth:
          newCustomer.date_of_birth ||
          null,

        gender:
          newCustomer.gender ||
          null,

        employer:
          newCustomer.employer.trim() ||
          null,

        occupation:
          newCustomer.occupation.trim() ||
          null,

        monthly_income:
          newCustomer.monthly_income !== ""
            ? Number(
                newCustomer.monthly_income
              )
            : null,

        physical_address:
          newCustomer.physical_address.trim() ||
          null,

        postal_address:
          newCustomer.postal_address.trim() ||
          null,

        alternative_phone:
          newCustomer.alternative_phone.trim() ||
          null,

        is_active: true,
        is_deleted: false,
      };

      const created =
        await addCustomer(
          customerToCreate
        );

      const createdCustomer =
        Array.isArray(created)
          ? created[0]
          : created;

      if (!createdCustomer?.id) {
        throw new Error(
          "Customer was created, but the new customer record could not be loaded."
        );
      }

      setVerifiedCustomer(
        createdCustomer
      );

      setCustomerNotFound(false);

      setIdNumber(
        createdCustomer.id_number ||
          cleanIdNumber
      );

      setCreateCustomerOpen(false);
      setCreateCustomerError("");
      setIdCheckError("");

      if (!skipDocumentCheck) {
        await checkCustomerDocuments(
          createdCustomer
        );
      }
    } catch (err) {
      console.error(
        "Create customer error:",
        err
      );

      setCreateCustomerError(
        err?.message ||
          "Unable to create the customer."
      );
    } finally {
      setCreatingCustomer(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * SKIP DOCUMENT CHECK
   * ---------------------------------------------------------
   */

  function handleSkipDocumentCheckChange(
    event
  ) {
    const checked = event.target.checked;

    setSkipDocumentCheck(checked);
    setDocumentCheckError("");

    if (checked) {
      setDocumentStatus(null);

      setUseBankStatementAsProofOfResidence(
        false
      );

      setSelectedFiles({
        idDocument: null,
        bankStatement: null,
        payslip: null,
        proofOfResidence: null,
      });
    } else if (verifiedCustomer) {
      checkCustomerDocuments(
        verifiedCustomer
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * BANK STATEMENT AS PROOF OF RESIDENCE
   * ---------------------------------------------------------
   */

  function handleBankStatementProofOfResidenceChange(
    event
  ) {
    const checked = event.target.checked;

    setUseBankStatementAsProofOfResidence(
      checked
    );

    setDocumentCheckError("");
  }

  /*
   * ---------------------------------------------------------
   * DOCUMENT FILE SELECTION
   * ---------------------------------------------------------
   */

  function handleFileChange(
    documentKey,
    event
  ) {
    const file =
      event.target.files?.[0] || null;

    setSelectedFiles((previous) => ({
      ...previous,
      [documentKey]: file,
    }));

    setDocumentCheckError("");
  }

  /*
   * ---------------------------------------------------------
   * DOCUMENT UPLOAD
   * ---------------------------------------------------------
   */

  async function handleUploadDocument({
    documentKey,
    documentType,
    label,
  }) {
    if (skipDocumentCheck) {
      return;
    }

    if (!verifiedCustomer?.id) {
      setDocumentCheckError(
        "Please verify the customer before uploading documents."
      );
      return;
    }

    const file =
      selectedFiles[documentKey];

    if (!file) {
      setDocumentCheckError(
        `Please select the ${label} file first.`
      );
      return;
    }

    try {
      setUploadingDocument(documentKey);
      setDocumentCheckError("");

      await uploadDocument({
        file,
        documentType,
        documentCategory:
          DOCUMENT_CATEGORIES.CUSTOMER,
        documentName: file.name,
        customerId:
          verifiedCustomer.id,
        customerIdNumber:
          verifiedCustomer.id_number,
      });

      setSelectedFiles((previous) => ({
        ...previous,
        [documentKey]: null,
      }));

      await checkCustomerDocuments(
        verifiedCustomer
      );
    } catch (err) {
      console.error(
        `Upload ${label} error:`,
        err
      );

      setDocumentCheckError(
        err?.message ||
          `Unable to upload the ${label}.`
      );
    } finally {
      setUploadingDocument("");
    }
  }

  /*
   * ---------------------------------------------------------
   * CONTINUE TO LOAN
   * ---------------------------------------------------------
   */

  function handleContinueToLoan() {
    if (!verifiedCustomer) {
      setIdCheckError(
        "Please verify or create the customer first."
      );

      return;
    }

    if (
      checkingCustomer ||
      checkingDocuments ||
      uploadingDocument ||
      creatingCustomer
    ) {
      return;
    }

    /*
     * SKIP DOCUMENT CHECK
     */
    if (skipDocumentCheck) {
      setIdCheckOpen(false);
      setOpen(true);
      return;
    }

    /*
     * NORMAL DOCUMENT VALIDATION
     */
    if (!documentStatus) {
      setDocumentCheckError(
        "Please complete the customer document check first."
      );

      return;
    }

    const missingDocuments = [];

    /*
     * ID DOCUMENT IS MANDATORY.
     */
    if (!documentStatus.idDocument) {
      missingDocuments.push(
        "ID Document"
      );
    }

    if (!documentStatus.bankStatement) {
      missingDocuments.push(
        "Bank Statement"
      );
    }

    if (!documentStatus.payslip) {
      missingDocuments.push(
        "Payslip"
      );
    }

    /*
     * Proof of Residence is required unless
     * the Bank Statement checkbox is selected.
     */
    const proofOfResidenceSatisfied =
      Boolean(
        documentStatus.proofOfResidence
      ) ||
      Boolean(
        useBankStatementAsProofOfResidence &&
          documentStatus.bankStatement
      );

    if (!proofOfResidenceSatisfied) {
      missingDocuments.push(
        "Proof of Residence"
      );
    }

    if (missingDocuments.length > 0) {
      setDocumentCheckError(
        `The following customer documents are missing or expired: ${missingDocuments.join(
          ", "
        )}. Upload the required documents before continuing.`
      );

      return;
    }

    setIdCheckOpen(false);
    setOpen(true);
  }

  /*
   * ---------------------------------------------------------
   * CLOSE ID CHECK
   * ---------------------------------------------------------
   */

  function handleCloseIdCheck() {
    if (
      checkingCustomer ||
      checkingDocuments ||
      uploadingDocument ||
      creatingCustomer
    ) {
      return;
    }

    setIdCheckOpen(false);
    setCreateCustomerOpen(false);

    resetLoanStartState();
  }

  /*
   * ---------------------------------------------------------
   * LOAN SAVED
   * ---------------------------------------------------------
   */

  function handleSaved() {
    setOpen(false);
    resetLoanStartState();

    setRefreshKey(
      (previous) => previous + 1
    );
  }

  function handleLoanFormClose() {
    setOpen(false);
    resetLoanStartState();
  }

  /*
   * ID + BANK STATEMENT + PAYSLIP must be present.
   *
   * Proof of Residence can be satisfied either by:
   * 1. A valid Proof of Residence, OR
   * 2. A valid Bank Statement when the checkbox
   *    is selected.
   */
  const proofOfResidenceSatisfied =
    Boolean(documentStatus) &&
    (
      Boolean(
        documentStatus?.proofOfResidence
      ) ||
      Boolean(
        useBankStatementAsProofOfResidence &&
          documentStatus?.bankStatement
      )
    );

  const allDocumentsValid =
    Boolean(documentStatus) &&
    Boolean(documentStatus.idDocument) &&
    Boolean(documentStatus.bankStatement) &&
    Boolean(documentStatus.payslip) &&
    proofOfResidenceSatisfied;

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  return (
    <>
      <LoanToolbar
        onAdd={handleNewLoan}
        search={search}
        onSearchChange={setSearch}
      />

      <LoanTable
        refreshKey={refreshKey}
        search={search}
      />

      {/* =====================================================
          ID CHECK DIALOG
      ===================================================== */}

      <Dialog
        open={idCheckOpen}
        onClose={handleCloseIdCheck}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Verify Customer
        </DialogTitle>

        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography
              variant="body2"
              sx={{ mb: 2 }}
            >
              Enter the customer's ID number before
              opening the loan form. The system will
              verify the customer and, unless document
              checking is skipped, automatically check
              all required customer documents.
            </Typography>

            {idCheckError && (
              <Alert
                severity={
                  customerNotFound
                    ? "warning"
                    : "error"
                }
                sx={{ mb: 2 }}
              >
                {idCheckError}
              </Alert>
            )}

            {/* =================================================
                REGISTER CUSTOMER BUTTON
                ONLY SHOWN WHEN ID CHECK FINDS NO CUSTOMER
            ================================================= */}

            {customerNotFound &&
              !verifiedCustomer && (
                <Box
                  sx={{
                    mb: 2,
                    p: 2,
                    border: "1px solid",
                    borderColor: "warning.main",
                    borderRadius: 1,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ mb: 1.5 }}
                  >
                    This ID number is not registered.
                    You can register the customer now
                    and continue with the loan.
                  </Typography>

                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={
                      handleOpenCreateCustomer
                    }
                    disabled={
                      checkingCustomer ||
                      checkingDocuments ||
                      Boolean(
                        uploadingDocument
                      ) ||
                      creatingCustomer
                    }
                  >
                    Register Customer &amp; Loan
                  </Button>
                </Box>
              )}

            <TextField
              fullWidth
              label="Customer ID Number"
              value={idNumber}
              onChange={(event) => {
                const value =
                  event.target.value;

                setIdNumber(value);

                setCustomerNotFound(false);

                setIdCheckError("");
                setDocumentCheckError("");
                setVerifiedCustomer(null);
                setDocumentStatus(null);

                setSelectedFiles({
                  idDocument: null,
                  bankStatement: null,
                  payslip: null,
                  proofOfResidence: null,
                });
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter"
                ) {
                  event.preventDefault();

                  if (
                    !checkingCustomer &&
                    !checkingDocuments &&
                    !uploadingDocument &&
                    !creatingCustomer &&
                    idNumber.trim()
                  ) {
                    handleCheckIdNumber();
                  }
                }
              }}
              inputProps={{
                maxLength: 13,
              }}
              disabled={
                checkingCustomer ||
                checkingDocuments ||
                Boolean(uploadingDocument) ||
                creatingCustomer
              }
              autoFocus
            />

            {/* =================================================
                VERIFIED CUSTOMER
            ================================================= */}

            {verifiedCustomer && (
              <Alert
                severity="success"
                sx={{ mt: 2 }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: "bold",
                  }}
                >
                  Customer found
                </Typography>

                <Typography
                  variant="body2"
                  sx={{ mt: 0.5 }}
                >
                  Customer Number:{" "}
                  {
                    verifiedCustomer.customer_number
                  }
                </Typography>

                <Typography variant="body2">
                  Name:{" "}
                  {verifiedCustomer.first_name}{" "}
                  {verifiedCustomer.last_name}
                </Typography>

                <Typography variant="body2">
                  ID Number:{" "}
                  {verifiedCustomer.id_number}
                </Typography>

                {verifiedCustomer.cellphone && (
                  <Typography variant="body2">
                    Cellphone:{" "}
                    {
                      verifiedCustomer.cellphone
                    }
                  </Typography>
                )}

                {verifiedCustomer.email && (
                  <Typography variant="body2">
                    Email:{" "}
                    {verifiedCustomer.email}
                  </Typography>
                )}
              </Alert>
            )}

            {/* =================================================
                SKIP DOCUMENT CHECK
            ================================================= */}

            {verifiedCustomer && (
              <Box
                sx={{
                  mt: 2,
                  p: 1.5,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={
                        skipDocumentCheck
                      }
                      onChange={
                        handleSkipDocumentCheckChange
                      }
                      disabled={
                        checkingCustomer ||
                        checkingDocuments ||
                        Boolean(
                          uploadingDocument
                        )
                      }
                    />
                  }
                  label="Skip document check for this loan"
                />

                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    ml: 4,
                    mt: -0.5,
                  }}
                >
                  When selected, the system will
                  not check or require ID Document,
                  Bank Statement, Payslip, or Proof
                  of Residence for this loan.
                </Typography>

                {/* =================================================
                    BANK STATEMENT AS PROOF OF RESIDENCE
                ================================================= */}

                <FormControlLabel
                  control={
                    <Checkbox
                      checked={
                        useBankStatementAsProofOfResidence
                      }
                      onChange={
                        handleBankStatementProofOfResidenceChange
                      }
                      disabled={
                        checkingCustomer ||
                        checkingDocuments ||
                        Boolean(
                          uploadingDocument
                        ) ||
                        skipDocumentCheck
                      }
                    />
                  }
                  label="Use Bank Statement as Proof of Residence"
                />

                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    ml: 4,
                    mt: -0.5,
                  }}
                >
                  When selected, a valid Bank Statement
                  will also satisfy the Proof of Residence
                  requirement for this loan.
                </Typography>
              </Box>
            )}

            {/* =================================================
                DOCUMENT CHECKING
            ================================================= */}

            {!skipDocumentCheck &&
              checkingDocuments && (
                <Box
                  sx={{
                    mt: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <CircularProgress size={20} />

                  <Typography variant="body2">
                    Checking customer documents...
                  </Typography>
                </Box>
              )}

            {!skipDocumentCheck &&
              documentCheckError && (
                <Alert
                  severity="warning"
                  sx={{ mt: 2 }}
                >
                  {documentCheckError}
                </Alert>
              )}

            {/* =================================================
                DOCUMENT STATUS
            ================================================= */}

            {!skipDocumentCheck &&
              documentStatus && (
                <Box sx={{ mt: 2 }}>
                  <Divider sx={{ mb: 2 }} />

                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: "bold",
                      mb: 1,
                    }}
                  >
                    Customer Document Status
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    ID Document, Bank Statement and
                    Payslip are required. Proof of
                    Residence is required unless the
                    Bank Statement option above is
                    selected. Valid six-month documents
                    are automatically reused.
                  </Typography>

                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.5,
                    }}
                  >
                    <DocumentStatusRow
                      label="ID Document"
                      document={
                        documentStatus.idDocument
                      }
                      file={
                        selectedFiles.idDocument
                      }
                      uploading={
                        uploadingDocument ===
                        "idDocument"
                      }
                      onFileChange={(event) =>
                        handleFileChange(
                          "idDocument",
                          event
                        )
                      }
                      onUpload={() =>
                        handleUploadDocument({
                          documentKey:
                            "idDocument",
                          documentType:
                            "ID Document",
                          label:
                            "ID Document",
                        })
                      }
                    />

                    <DocumentStatusRow
                      label="Bank Statement"
                      document={
                        documentStatus.bankStatement
                      }
                      file={
                        selectedFiles.bankStatement
                      }
                      uploading={
                        uploadingDocument ===
                        "bankStatement"
                      }
                      onFileChange={(event) =>
                        handleFileChange(
                          "bankStatement",
                          event
                        )
                      }
                      onUpload={() =>
                        handleUploadDocument({
                          documentKey:
                            "bankStatement",
                          documentType:
                            "Bank Statement",
                          label:
                            "Bank Statement",
                        })
                      }
                    />

                    <DocumentStatusRow
                      label="Payslip"
                      document={
                        documentStatus.payslip
                      }
                      file={
                        selectedFiles.payslip
                      }
                      uploading={
                        uploadingDocument ===
                        "payslip"
                      }
                      onFileChange={(event) =>
                        handleFileChange(
                          "payslip",
                          event
                        )
                      }
                      onUpload={() =>
                        handleUploadDocument({
                          documentKey:
                            "payslip",
                          documentType:
                            "Payslip",
                          label: "Payslip",
                        })
                      }
                    />

                    <DocumentStatusRow
                      label="Proof of Residence"
                      document={
                        documentStatus.proofOfResidence
                      }
                      file={
                        selectedFiles.proofOfResidence
                      }
                      uploading={
                        uploadingDocument ===
                        "proofOfResidence"
                      }
                      disabled={
                        useBankStatementAsProofOfResidence
                      }
                      onFileChange={(event) =>
                        handleFileChange(
                          "proofOfResidence",
                          event
                        )
                      }
                      onUpload={() =>
                        handleUploadDocument({
                          documentKey:
                            "proofOfResidence",
                          documentType:
                            "Proof of Residence",
                          label:
                            "Proof of Residence",
                        })
                      }
                    />
                  </Box>

                  {useBankStatementAsProofOfResidence &&
                    documentStatus.bankStatement && (
                      <Alert
                        severity="info"
                        sx={{ mt: 2 }}
                      >
                        The valid Bank Statement will
                        be used as Proof of Residence
                        for this loan.
                      </Alert>
                    )}

                  {allDocumentsValid && (
                    <Alert
                      severity="success"
                      sx={{ mt: 2 }}
                    >
                      All required customer documents
                      are valid. The documents will be
                      used for this loan application.
                    </Alert>
                  )}
                </Box>
              )}

            {/* =================================================
                SKIPPED MESSAGE
            ================================================= */}

            {skipDocumentCheck &&
              verifiedCustomer && (
                <Alert
                  severity="info"
                  sx={{ mt: 2 }}
                >
                  Document checking has been skipped
                  for this loan. No customer document
                  validation or upload will be performed.
                </Alert>
              )}
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={handleCloseIdCheck}
            disabled={
              checkingCustomer ||
              checkingDocuments ||
              Boolean(uploadingDocument) ||
              creatingCustomer
            }
          >
            Cancel
          </Button>

          <Button
            variant="outlined"
            onClick={handleCheckIdNumber}
            disabled={
              checkingCustomer ||
              checkingDocuments ||
              Boolean(uploadingDocument) ||
              creatingCustomer ||
              !idNumber.trim()
            }
          >
            {checkingCustomer ||
            checkingDocuments ? (
              <>
                <CircularProgress
                  size={20}
                  sx={{ mr: 1 }}
                />

                {checkingCustomer
                  ? "Checking..."
                  : "Checking Documents..."}
              </>
            ) : (
              "Check ID Number"
            )}
          </Button>

          <Button
            variant="contained"
            onClick={handleContinueToLoan}
            disabled={
              checkingCustomer ||
              checkingDocuments ||
              Boolean(uploadingDocument) ||
              creatingCustomer ||
              !verifiedCustomer ||
              (!skipDocumentCheck &&
                !allDocumentsValid)
            }
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* =====================================================
          CREATE CUSTOMER DIALOG
      ===================================================== */}

      <Dialog
        open={createCustomerOpen}
        onClose={() => {
          if (!creatingCustomer) {
            setCreateCustomerOpen(false);
          }
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Register New Customer
        </DialogTitle>

        <DialogContent>
          <Box
            component="form"
            id="create-customer-form"
            onSubmit={handleCreateCustomer}
            sx={{ pt: 1 }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 2 }}
            >
              This customer was not found. Register
              the customer below. The customer will be
              automatically saved before continuing with
              the loan application.
            </Typography>

            {createCustomerError && (
              <Alert
                severity="error"
                sx={{ mb: 2 }}
              >
                {createCustomerError}
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="First Name"
                  value={
                    newCustomer.first_name
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "first_name",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                  autoFocus
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Last Name"
                  value={
                    newCustomer.last_name
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "last_name",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="ID Number"
                  value={
                    newCustomer.id_number
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "id_number",
                      event.target.value
                    )
                  }
                  inputProps={{
                    maxLength: 13,
                  }}
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Cellphone"
                  value={
                    newCustomer.cellphone
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "cellphone",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="email"
                  label="Email"
                  value={
                    newCustomer.email
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "email",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="Date of Birth"
                  value={
                    newCustomer.date_of_birth
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "date_of_birth",
                      event.target.value
                    )
                  }
                  InputLabelProps={{
                    shrink: true,
                  }}
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  select
                  label="Gender"
                  value={
                    newCustomer.gender
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "gender",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                >
                  <MenuItem value="">
                    Select Gender
                  </MenuItem>

                  <MenuItem value="Male">
                    Male
                  </MenuItem>

                  <MenuItem value="Female">
                    Female
                  </MenuItem>

                  <MenuItem value="Other">
                    Other
                  </MenuItem>
                </TextField>
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Employer"
                  value={
                    newCustomer.employer
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "employer",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Occupation"
                  value={
                    newCustomer.occupation
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "occupation",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Monthly Income"
                  value={
                    newCustomer.monthly_income
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "monthly_income",
                      event.target.value
                    )
                  }
                  inputProps={{
                    min: 0,
                    step: "0.01",
                  }}
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Alternative Phone"
                  value={
                    newCustomer.alternative_phone
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "alternative_phone",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Physical Address"
                  value={
                    newCustomer.physical_address
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "physical_address",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Postal Address"
                  value={
                    newCustomer.postal_address
                  }
                  onChange={(event) =>
                    handleNewCustomerChange(
                      "postal_address",
                      event.target.value
                    )
                  }
                  disabled={creatingCustomer}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() =>
              setCreateCustomerOpen(false)
            }
            disabled={creatingCustomer}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            form="create-customer-form"
            variant="contained"
            disabled={
              creatingCustomer ||
              !newCustomer.first_name.trim() ||
              !newCustomer.last_name.trim() ||
              !newCustomer.id_number.trim()
            }
          >
            {creatingCustomer ? (
              <>
                <CircularProgress
                  size={20}
                  sx={{ mr: 1 }}
                />
                Creating...
              </>
            ) : (
              "Create Customer & Continue"
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* =====================================================
          EXISTING LOAN FORM
      ===================================================== */}

      <LoanForm
        open={open}
        customer={verifiedCustomer}
        skipDocumentCheck={
          skipDocumentCheck
        }
        onClose={handleLoanFormClose}
        onSaved={handleSaved}
      />
    </>
  );
}

/*
 * ===========================================================
 * DOCUMENT STATUS ROW
 * ===========================================================
 */

function DocumentStatusRow({
  label,
  document,
  file,
  uploading,
  disabled = false,
  onFileChange,
  onUpload,
}) {
  return (
    <Box
      sx={{
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box>
          <Typography
            variant="body2"
            sx={{ fontWeight: "bold" }}
          >
            {label}
          </Typography>

          {document && (
            <Typography
              variant="caption"
              color="text.secondary"
            >
              {document.document_name}
            </Typography>
          )}
        </Box>

        <Chip
          label={
            document
              ? "Valid"
              : "Required"
          }
          color={
            document
              ? "success"
              : "warning"
          }
          size="small"
        />
      </Box>

      {!document && (
        <Box sx={{ mt: 1.5 }}>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={onFileChange}
            disabled={
              uploading || disabled
            }
            style={{
              width: "100%",
              marginBottom: "8px",
            }}
          />

          {file && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                mb: 1,
              }}
            >
              Selected: {file.name}
            </Typography>
          )}

          <Button
            variant="outlined"
            size="small"
            onClick={onUpload}
            disabled={
              disabled ||
              !file ||
              uploading
            }
          >
            {uploading ? (
              <>
                <CircularProgress
                  size={18}
                  sx={{ mr: 1 }}
                />
                Uploading...
              </>
            ) : (
              "Upload Document"
            )}
          </Button>

          {disabled && !document && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                mt: 0.5,
              }}
            >
              Bank Statement is being used as
              Proof of Residence.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}