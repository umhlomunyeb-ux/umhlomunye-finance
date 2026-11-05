import { useEffect, useState } from "react";

import {
  addLoanApplication,
  saveApplicationDocumentOffline,
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
  CircularProgress,
  Chip,
  Select,
  FormControl,
  InputLabel,
  Slider,
  Radio,
  RadioGroup,
  FormControlLabel,
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

function normalizeSaPhoneNumber(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 9 && /^[6-8]/.test(digits)) digits = `0${digits}`;
  return digits;
}

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  cellphone: "",
  email: "",
  physical_address: "",
  work_address: "",
  work_telephone: "",
  employer: "",
  employment_status: "",
  monthly_income: "",
  other_income: "",
  bank_name: "",
  account_number: "",
  amount_requested: "100",
  loan_purpose: "",
  preferred_payment_date: "",
  collection_preference: "",
  notes: "",
  id_number: "",
};

export default function PublicApplication() {
  const [idNumber, setIdNumber] = useState("");

  const [checkingId, setCheckingId] = useState(false);
  const [idChecked, setIdChecked] = useState(false);
  const [existingCustomer, setExistingCustomer] =
    useState(false);

  const [customerNumber, setCustomerNumber] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [maskedOtpEmail, setMaskedOtpEmail] = useState("");
  const [customerAction, setCustomerAction] = useState("");
  const [creditLimitReason, setCreditLimitReason] = useState("");
  const [requestedCreditLimit, setRequestedCreditLimit] = useState("");
  const [creditLimitPayslip, setCreditLimitPayslip] = useState(null);
  const [creditLimitSubmitting, setCreditLimitSubmitting] = useState(false);
  const [creditLimitRequestResult, setCreditLimitRequestResult] = useState(null);
  const [topUpEligibility, setTopUpEligibility] = useState(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpResult, setTopUpResult] = useState(null);

  const [resumeApplication, setResumeApplication] = useState(null);

  const [submitted, setSubmitted] = useState(false);

  const [applicationNumber, setApplicationNumber] =
    useState("");

  const [applicationId, setApplicationId] =
    useState("");

  const [applicationLocalId, setApplicationLocalId] =
    useState("");

  const [uploadToken, setUploadToken] =
    useState("");

  const [pendingSync, setPendingSync] = useState(false);

  const [affordabilityAssessment, setAffordabilityAssessment] = useState(null);
  const [fundingAssessment, setFundingAssessment] = useState(null);
  const [fundingBookingComplete, setFundingBookingComplete] = useState(false);
  const [fundingBookingMessage, setFundingBookingMessage] = useState("");
  const [preferredFundingDate, setPreferredFundingDate] = useState("");
  const [publicOffer, setPublicOffer] = useState(null);
  const [acceptanceChecked, setAcceptanceChecked] = useState(false);
  const [offerFinalizing, setOfferFinalizing] = useState(false);
  const [agreementUrl, setAgreementUrl] = useState("");

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

  const [selectedTermMonths, setSelectedTermMonths] = useState(1);

  const [expenses, setExpenses] = useState([
    "Grocery",
    "Housing",
    "Clothing",
    "Transportation",
    "Existing Loan Repayments",
    "Other Expenses",
  ].map((category) => ({ category, description: "", monthly_amount: "" })));

  const monthlyExpenseTotal = expenses.reduce(
    (total, item) => total + Math.max(0, Number(item.monthly_amount) || 0),
    0
  );

  const selectedLoanAmount = Math.min(6000, Math.max(100, Number(form.amount_requested) || 100));
  const selectedLoanTerm = selectedLoanAmount < 5000 ? 1 : selectedTermMonths;
  const initialLoanInterest = Number((selectedLoanAmount * 0.4).toFixed(2));
  const initialLoanBalance = Number((selectedLoanAmount + initialLoanInterest).toFixed(2));
  const displayedInstalment = selectedLoanTerm === 2
    ? Number((initialLoanBalance * 1.4 / 2.4).toFixed(2))
    : initialLoanBalance;
  const displayedTotalRepayment = Number((displayedInstalment * selectedLoanTerm).toFixed(2));
  const displayedDayEightInterest = selectedLoanTerm === 2
    ? Number(((initialLoanBalance - displayedInstalment) * 0.4).toFixed(2))
    : 0;
  const formatCurrency = (value) => new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

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
    setOtpSent(false);
    setOtpCode("");
    setVerificationToken("");
    setMaskedOtpEmail("");
    setCustomerAction("");
    setTopUpEligibility(null);
    setTopUpAmount("");
    setTopUpResult(null);
    setResumeApplication(null);
    setIdMessage("");
    setError("");
    setSelectedTermMonths(1);

    setForm((previous) => ({
      ...previous,
      id_number: value,
    }));
  }

  async function handleCheckId() {
    setError("");
    setIdMessage("");
    const normalizedId = normalizeId(idNumber);
    if (normalizedId.length !== 13) {
      setError("Please enter a valid 13-digit South African ID number.");
      return;
    }
    if (!navigator.onLine) {
      setIdChecked(false);
      setExistingCustomer(false);
      setCustomerNumber("");
      setForm((previous) => ({ ...previous, id_number: normalizedId }));
      setIdMessage("An internet connection is required to check this ID securely. Reconnect and check the ID again; it will not be saved offline.");
      return;
    }
    try {
      setCheckingId(true);
      setOtpSent(false);
      setOtpCode("");
      setVerificationToken("");
      setMaskedOtpEmail("");
      setCustomerAction("");
      const { data, error: startError } = await supabase.functions.invoke("public-customer-otp", {
        body: { action: "start", idNumber: normalizedId },
      });
      if (startError) throw startError;
      if (!data?.success) throw new Error(data?.error || "Unable to check this ID.");
      setForm((previous) => ({ ...EMPTY_FORM, ...previous, id_number: normalizedId }));
      if (data.existingCustomer || data.otpRequired) {
        if (data.emailMissing) throw new Error(data.error);
        setOtpSent(true);
        setMaskedOtpEmail(data.maskedEmail || "your registered email address");
        setIdMessage("A six-digit verification code has been sent to your registered email address.");
        setIdChecked(false);
        return;
      }
      setExistingCustomer(false);
      setCustomerNumber("");
      setTopUpEligibility(null);
      setResumeApplication(null);
      setIdChecked(true);
      setCustomerAction("new_loan");
      setForm({ ...EMPTY_FORM, id_number: normalizedId });
      setIdMessage("No existing customer record was found. Please complete the new loan application.");
    } catch (err) {
      console.error("PUBLIC CUSTOMER OTP START ERROR:", err);
      setIdChecked(false);
      setError(err?.message || "Unable to check the ID number. Please try again.");
    } finally {
      setCheckingId(false);
    }
  }

  async function handleVerifyOtp() {
    setError("");
    if (!/^\d{6}$/.test(String(otpCode).replace(/\D/g, ""))) {
      setError("Enter the six-digit verification code sent to your email.");
      return;
    }
    try {
      setOtpVerifying(true);
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke("public-customer-otp", {
        body: { action: "verify", idNumber: normalizeId(idNumber), otp: String(otpCode).replace(/\D/g, "") },
      });
      if (verifyError) throw verifyError;
      if (!verifyData?.success || !verifyData?.verificationToken) throw new Error(verifyData?.error || "The verification code could not be confirmed.");
      const token = verifyData.verificationToken;
      const { data, error: optionsError } = await supabase.functions.invoke("public-customer-otp", {
        body: { action: "options", idNumber: normalizeId(idNumber), verificationToken: token },
      });
      if (optionsError) throw optionsError;
      if (!data?.success) throw new Error(data?.error || "Unable to load the verified customer record.");
      const customer = data.customer;
      setVerificationToken(token);
      if (!customer) {
        setExistingCustomer(false);
        setCustomerNumber("");
        setTopUpEligibility(null);
        setResumeApplication(data.resumeApplication || null);
        setForm({ ...EMPTY_FORM, id_number: normalizeId(idNumber) });
        setIdChecked(true);
        setOtpSent(false);
        setOtpCode("");
        setCustomerAction("new_loan");
        setIdMessage("Your identity has been verified. You can continue your previous quotation or start a new application.");
        return;
      }
      setExistingCustomer(true);
      setCustomerNumber(customer.customer_number || "");
      setTopUpEligibility(data.topUpEligibility || null);
      setResumeApplication(data.resumeApplication || null);
      setForm({
        ...EMPTY_FORM,
        id_number: normalizeId(idNumber),
        first_name: customer.first_name || "",
        last_name: customer.last_name || "",
        cellphone: customer.cellphone || "",
        email: customer.email || "",
        physical_address: customer.physical_address || "",
        employer: customer.employer || "",
        employment_status: customer.employment_status || "",
        monthly_income: customer.monthly_income ?? "",
        other_income: customer.other_income ?? "",
        bank_name: customer.bank_name || "",
        account_number: customer.account_number || "",
        loan_purpose: customer.loan_purpose || "",
        collection_preference: customer.collection_preference || "",
        amount_requested: "100",
      });
      setIdChecked(true);
      setOtpSent(false);
      setOtpCode("");
      setCustomerAction("");
      setIdMessage("Identity verified. Choose what you would like to do.");
    } catch (err) {
      console.error("PUBLIC CUSTOMER OTP VERIFY ERROR:", err);
      setError(err?.message || "Verification failed. Please request a new code.");
    } finally {
      setOtpVerifying(false);
    }
  }

  async function handleSubmitCreditLimitRequest() {
    setError("");
    setCreditLimitRequestResult(null);
    if (!verificationToken) {
      setError("Verify your identity again before submitting this request.");
      return;
    }
    if (!creditLimitPayslip) {
      setError("Upload your latest payslip to request a credit-limit increase.");
      return;
    }
    if (!creditLimitReason.trim() || creditLimitReason.trim().length < 10) {
      setError("Please explain why you are requesting a credit-limit increase (at least 10 characters).");
      return;
    }
    try {
      setCreditLimitSubmitting(true);
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = () => reject(new Error("Unable to read the payslip file."));
        reader.readAsDataURL(creditLimitPayslip);
      });
      const { data, error: requestError } = await supabase.functions.invoke("public-customer-otp", {
        body: {
          action: "credit_limit_request",
          idNumber: normalizeId(idNumber),
          verificationToken,
          requestedCreditLimit: Number(requestedCreditLimit),
          reason: creditLimitReason,
          payslipBase64: base64,
          payslipMimeType: creditLimitPayslip.type,
        },
      });
      if (requestError) throw requestError;
      if (!data?.success) throw new Error(data?.error || "Unable to submit your credit-limit request.");
      setCreditLimitRequestResult(data.request);
      setCreditLimitPayslip(null);
      setCreditLimitReason("");
      setRequestedCreditLimit("");
    } catch (err) {
      setError(err?.message || "Unable to submit your credit-limit request.");
    } finally {
      setCreditLimitSubmitting(false);
    }
  }

  async function handleSubmitTopUp() {
    setError("");
    setTopUpResult(null);
    const amount = Number(topUpAmount);
    const maximum = Number(topUpEligibility?.maximum_top_up || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid top-up amount.");
      return;
    }
    if (amount > maximum) {
      setError(`Your requested top-up is above your available credit limit. Maximum top-up amount: ${formatCurrency(maximum)}.`);
      return;
    }
    setLoading(true);
    try {
      const { data, error: submitError } = await supabase.functions.invoke("public-customer-otp", {
        body: { action: "top_up", idNumber: normalizeId(idNumber), verificationToken, amount },
      });
      if (submitError) throw submitError;
      if (!data?.success) throw new Error(data?.error || "Unable to submit the top-up.");
      setTopUpResult(data.result || null);
    } catch (err) {
      setError(err?.message || "Unable to submit the top-up.");
    } finally {
      setLoading(false);
    }
  }

  async function handleContinuePreviousApplication() {
    if (!resumeApplication) return;
    setLoading(true);
    setError("");
    try {
      const savedForm = resumeApplication.form || {};
      setForm({
        ...EMPTY_FORM,
        ...savedForm,
        id_number: idNumber,
        amount_requested: String(savedForm.amount_requested ?? resumeApplication.offer_amount ?? "100"),
        preferred_payment_date: savedForm.preferred_payment_date || resumeApplication.preferred_payment_date || "",
      });
      const savedExpenses = Array.isArray(resumeApplication.expenses) ? resumeApplication.expenses : [];
      setExpenses(savedExpenses.length
        ? savedExpenses.map((item) => ({
            category: item.category,
            description: item.description || "",
            monthly_amount: String(item.monthly_amount ?? "0"),
          }))
        : ["Grocery", "Housing", "Clothing", "Transportation", "Existing Loan Repayments", "Other Expenses"]
            .map((category) => ({ category, description: "", monthly_amount: "0" })));
      setSelectedTermMonths(Number(resumeApplication.offer_term_months || 1));
      setApplicationId(resumeApplication.application_id);
      setApplicationNumber(resumeApplication.application_number);
      setApplicationLocalId("");
      setUploadToken(resumeApplication.upload_token);
      setPendingSync(false);
      setAffordabilityAssessment({
        status: resumeApplication.affordability_status,
        monthly_expenses: resumeApplication.monthly_expenses_total,
        disposable_income: resumeApplication.disposable_income,
        reason: resumeApplication.affordability_reason,
      });
      setFundingAssessment(null);
      const { data: offerData, error: offerError } = await supabase.rpc(
        "get_public_application_offer",
        {
          p_application_id: resumeApplication.application_id,
          p_upload_token: resumeApplication.upload_token,
        }
      );
      if (offerError) throw offerError;
      setPublicOffer(offerData || null);
      setResumeApplication(null);
      setSubmitted(true);
    } catch (resumeError) {
      setError(resumeError?.message || "Unable to reopen your quotation. Please check your ID number and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartNewApplication() {
    if (!resumeApplication) return;
    setLoading(true);
    setError("");
    try {
      const { data: cancelData, error: cancelError } = await supabase.functions.invoke(
        "public-customer-otp",
        {
          body: {
            action: "cancel_resume",
            idNumber: normalizeId(idNumber),
            verificationToken,
            applicationId: resumeApplication.application_id,
          },
        }
      );
      if (cancelError) throw cancelError;
      if (!cancelData?.success || !cancelData?.result?.success) throw new Error(cancelData?.error || "The previous application could not be cancelled.");
      const data = cancelData.result;
      setResumeApplication(null);
      setIdMessage(`Previous quotation ${data.application_number || ""} cancelled. You can now complete a new application.`);
      setExpenses(["Grocery", "Housing", "Clothing", "Transportation", "Existing Loan Repayments", "Other Expenses"]
        .map((category) => ({ category, description: "", monthly_amount: "" })));
      setSelectedTermMonths(1);
      setPublicOffer(null);
      setApplicationId("");
      setApplicationNumber("");
      setUploadToken("");
    } catch (cancelError) {
      setError(cancelError?.message || "Unable to cancel the previous quotation. No new application has been started.");
    } finally {
      setLoading(false);
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
      const amount = Number(value);
      setSelectedTermMonths(amount >= 5000 ? 2 : 1);
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

  /*
   * Persist all selected documents into IndexedDB
   * before relying on an online upload.
   *
   * This prevents files from being lost if the network
   * disappears while the application is being submitted
   * or while documents are being uploaded.
   */
  async function saveDocumentsOffline(
    localApplicationId,
    serverApplicationId = null
  ) {
    if (!localApplicationId) {
      throw new Error(
        "The local application reference is missing. The supporting documents could not be stored."
      );
    }

    if (!documents.length) {
      return;
    }

    for (const document of documents) {
      await saveApplicationDocumentOffline({
        applicationLocalId:
          localApplicationId,

        applicationServerId:
          serverApplicationId,

        documentType:
          document.documentType,

        file:
          document.file,
      });
    }
  }

  /*
   * Online document upload.
   *
   * A failed document is deliberately NOT removed from
   * IndexedDB. The offline document queue therefore remains
   * the recovery mechanism for that document.
   */
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

    if (!id || !token) {
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
        /*
         * If the connection disappears before this document,
         * stop attempting network uploads. The document has
         * already been stored in IndexedDB.
         */
        if (!navigator.onLine) {
          failed.push(
            `${document.file.name}: waiting for internet connection.`
          );

          break;
        }

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
            !navigator.onLine
              ? "waiting for internet connection."
              : err?.message ||
                "Upload failed."
          }`
        );

        /*
         * Do not delete the local copy. It remains available
         * to the synchronization process.
         */
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
        `${uploaded} of ${documents.length} documents uploaded. The remaining documents are retained for synchronization.`
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

    const normalizedFormId =
      normalizeId(form.id_number);

    if (!normalizedFormId) {
      setError(
        "ID number is required."
      );
      return;
    }

    if (
      normalizedFormId.length !== 13
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
      amount < 100 ||
      amount > 6000
    ) {
      setError(
        "Choose a loan amount between R100 and R6,000."
      );
      return;
    }

    if (![1, 2].includes(selectedLoanTerm) || (amount < 5000 && selectedLoanTerm !== 1)) {
      setError("The selected repayment term is not available for this loan amount.");
      return;
    }

    if (!/^0\d{9}$/.test(normalizeSaPhoneNumber(form.cellphone))) {
      setError("Please enter a valid 10-digit cellphone number starting with 0.");
      return;
    }

    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!form.physical_address.trim()) {
      setError("Physical address is required.");
      return;
    }

    if (!form.work_address.trim()) {
      setError("Work address is required.");
      return;
    }

    if (!/^0\d{9}$/.test(normalizeSaPhoneNumber(form.work_telephone))) {
      setError("Please enter a valid 10-digit work telephone number starting with 0.");
      return;
    }

    const missingExpense = expenses.find((item) =>
      item.monthly_amount === "" || !Number.isFinite(Number(item.monthly_amount)) || Number(item.monthly_amount) < 0
    );
    if (missingExpense) {
      setError("Please enter a valid monthly amount (R0 or more) for every expense category.");
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
      /*
       * applicationService owns the online/offline decision.
       *
       * Online:
       *   - submit to server
       *   - receive real application ID/number/token
       *
       * Offline:
       *   - create local application record
       *   - queue synchronization
       *   - return local application reference
       */
      const data =
        await addLoanApplication({
          first_name:
            form.first_name.trim(),

          last_name:
            form.last_name.trim(),

          cellphone:
            normalizeSaPhoneNumber(form.cellphone),

          email:
            form.email.trim() || null,

          physical_address:
            form.physical_address.trim(),

          work_address:
            form.work_address.trim(),

          work_telephone:
            normalizeSaPhoneNumber(form.work_telephone),

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

          selected_term_months:
            selectedLoanTerm,

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
            normalizedFormId,

          verificationToken,

          monthly_expenses: expenses.map((item) => ({
            category: item.category,
            description: item.description,
            monthly_amount: Number(item.monthly_amount),
          })),
        });

      const result =
        Array.isArray(data)
          ? data[0]
          : data;

      /*
       * Local application reference returned by
       * applicationService when the application is queued.
       */
      const localId =
        result?.application_local_id ||
        result?.local_application_id ||
        result?.local_id ||
        null;

      /*
       * Real server application number.
       *
       * There is deliberately no generated/fake number when
       * the application is offline.
       */
      const number =
        result?.application_number;

      setAffordabilityAssessment(
        result?.affordability_assessment || null
      );
      setFundingAssessment(result?.funding_assessment || null);

      /*
       * Real server application ID.
       */
      const id =
        result?.application_id ||
        result?.id ||
        null;

      /*
       * Secure server document-upload token.
       *
       * This must never be fabricated locally.
       */
      const token =
        result?.upload_token ||
        null;

      const isPending =
        Boolean(
          result?.pending_sync ||
          result?.offline ||
          result?.queued ||
          result?.sync_state === "PENDING"
        );

      /*
       * ALWAYS save selected documents locally before
       * attempting online document uploads.
       *
       * For an offline application, localId is the queue
       * reference.
       *
       * For an online application, id is also accepted as
       * the local reference when the service does not return
       * a separate local ID.
       */
      if (documents.length > 0) {
        await saveDocumentsOffline(
          localId || id,
          id
        );
      }

      /*
       * OFFLINE / QUEUED APPLICATION
       *
       * No fake application number.
       * No fake application ID.
       * No fake upload token.
       *
       * The applicationService synchronization process owns
       * the transition from local application -> server
       * application.
       */
      if (isPending || !navigator.onLine) {
        setPendingSync(true);

        setApplicationNumber(
          number ||
            "WAITING FOR INTERNET"
        );

        setApplicationId(id || "");

        setApplicationLocalId(
          localId || ""
        );

        setUploadToken("");

        if (documents.length > 0) {
          setUploadMessage(
            `${documents.length} supporting document${
              documents.length === 1
                ? ""
                : "s"
            } saved securely on this device and waiting for synchronization.`
          );
        } else {
          setUploadMessage("");
        }

        setSubmitted(true);

        return;
      }

      /*
       * ONLINE APPLICATION
       *
       * The server has accepted the application and supplied
       * the real application details.
       */
      setPendingSync(false);

      setApplicationNumber(
        number || "SUBMITTED"
      );

      setApplicationId(id || "");

      setApplicationLocalId(
        localId || ""
      );

      setUploadToken(token || "");

      setSubmitted(true);

      /*
       * If supporting documents were selected but the server
       * did not supply a secure upload session, leave the
       * documents in IndexedDB instead of pretending that
       * they were uploaded.
       */
      if (documents.length > 0) {
        if (!id || !token) {
          setUploadMessage(
            `${documents.length} supporting document${
              documents.length === 1
                ? ""
                : "s"
            } saved securely and waiting for document synchronization.`
          );

          return;
        }

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

      /*
       * If the network disappeared during submission,
       * applicationService should have queued the application.
       *
       * Do not clear the form or discard selected documents.
       */
      if (!navigator.onLine) {
        setPendingSync(true);

        setApplicationNumber(
          "WAITING FOR INTERNET"
        );

        setUploadMessage(
          documents.length > 0
            ? `${documents.length} supporting document${
                documents.length === 1
                  ? ""
                  : "s"
              } remain selected and will be retained for synchronization.`
            : ""
        );

        setSubmitted(true);

        return;
      }

      setError(
        err?.message ||
          "Unable to submit application. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!applicationId || !uploadToken || pendingSync) return undefined;
    let active = true;
    const checkOffer = async () => {
      const { data, error: offerError } = await supabase.rpc("get_public_application_offer", {
        p_application_id: applicationId,
        p_upload_token: uploadToken,
      });
      if (!active || offerError || !data) return;
      setPublicOffer(data);
    };
    checkOffer();
    const timer = window.setInterval(checkOffer, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [applicationId, uploadToken, pendingSync]);

  async function handleAcceptPublicOffer() {
    try {
      setOfferFinalizing(true);
      setError("");
      if (publicOffer?.offer_status !== "ACCEPTED") {
        const { error: acceptError } = await supabase.rpc("accept_public_loan_offer", {
          p_application_id: applicationId,
          p_upload_token: uploadToken,
          p_accept: true,
          p_acceptance_ip: null,
        });
        if (acceptError) throw acceptError;
      }
      const { data, error: finalizeError } = await supabase.functions.invoke("finalize-public-loan-offer", {
        body: { applicationId, uploadToken },
      });
      if (finalizeError) throw finalizeError;
      if (!data?.success || !data?.signingUrl) throw new Error(data?.error || "The final agreement could not be prepared.");
      setAgreementUrl(data.signingUrl);
      setPublicOffer((current) => ({ ...current, offer_status: "FINALIZED" }));
    } catch (err) {
      setError(err?.message || "Unable to finalize the accepted quotation. Please retry.");
    } finally {
      setOfferFinalizing(false);
    }
  }

  async function handleDeclinePublicOffer() {
    try {
      setOfferFinalizing(true);
      const { error: declineError } = await supabase.rpc("accept_public_loan_offer", {
        p_application_id: applicationId,
        p_upload_token: uploadToken,
        p_accept: false,
        p_acceptance_ip: null,
      });
      if (declineError) throw declineError;
      setPublicOffer((current) => ({ ...current, offer_status: "DECLINED", status: "CANCELLED" }));
      setFundingBookingComplete(true);
      setFundingBookingMessage("You declined the quotation. Your application has been cancelled and reserved company funds have been released.");
    } catch (err) {
      setError(err?.message || "Unable to decline this quotation.");
    } finally {
      setOfferFinalizing(false);
    }
  }

  async function handleFundingBooking(choice) {
    try {
      setLoading(true);
      setError("");
      const { data, error: bookingError } = await supabase.rpc(
        "create_public_funding_booking",
        {
          p_application_id: applicationId,
          p_upload_token: uploadToken,
          p_choice: choice,
          p_preferred_funding_date: choice === "BOOK" ? preferredFundingDate : null,
        }
      );
      if (bookingError) throw bookingError;
      setFundingBookingComplete(true);
      setFundingBookingMessage(
        choice === "BOOK"
          ? `Your preferred funding date has been recorded. Queue position: ${data?.queue_position || "pending"}.`
          : `Your request has been added to the funding queue. Queue position: ${data?.queue_position || "pending"}.`
      );
    } catch (err) {
      setError(err?.message || "Unable to save your funding preference.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelFundingRequest() {
    try {
      setLoading(true);
      const { error: cancelError } = await supabase.rpc(
        "cancel_public_funding_booking",
        {
          p_application_id: applicationId,
          p_upload_token: uploadToken,
        }
      );
      if (cancelError) throw cancelError;
      setFundingBookingComplete(true);
      setFundingBookingMessage("Your funding request has been cancelled.");
    } catch (err) {
      setError(err?.message || "Unable to cancel the funding request.");
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
              {pendingSync
                ? "Application Saved"
                : "Application Submitted"}
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

            {pendingSync ? (
              <>
                <Alert
                  severity="warning"
                  sx={{
                    mt: 2,
                    textAlign: "left",
                  }}
                >
                  <strong>
                    Waiting for Internet
                  </strong>
                  <br />
                  Your application has been
                  saved on this device. It
                  will be synchronized with
                  the server when an internet
                  connection becomes available.
                </Alert>

                {documents.length >
                  0 && (
                  <Alert
                    severity="info"
                    sx={{                      mt: 2,
                      textAlign: "left",                    }}
                  >
                    {documents.length} supporting
                    document
                    {documents.length ===                    1
                      ? ""
                      : "s"}{" "}
                    {documents.length ===
                    1
                      ? "has"
                      : "have"}{" "}
                    also been saved on this
                    device and will be
                    synchronized with the
                    application.
                  </Alert>
                )}
              </>
            ) : (
              <Typography
                color="text.secondary"
              >
                Thank you for submitting your
                loan application. Your
                application will be reviewed
                by Umhlomunye Finance.
              </Typography>
            )}

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
                    <Alert
                      severity={
                        pendingSync
                          ? "info"
                          : "success"
                      }
                    >
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

            {["ISSUED", "ACCEPTED"].includes(publicOffer?.offer_status) && !publicOffer?.signing_token && (
              <Paper variant="outlined" sx={{ mt: 3, p: 2, textAlign: "left" }}>
                <Typography variant="h6" fontWeight="bold">Pre-Agreement Statement and Loan Quotation</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Review the proposed loan costs and repayment obligations before accepting. This is a quotation, not yet the final signed agreement.</Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography><strong>Application:</strong> {publicOffer.application_number}</Typography>
                <Typography><strong>Loan amount:</strong> R {Number(publicOffer.offer_amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</Typography>
                <Typography><strong>Interest rate:</strong> {Number(publicOffer.interest_rate || 0).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}%</Typography>
                <Typography><strong>Interest:</strong> R {Number(publicOffer.offer_interest_amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</Typography>
                <Alert severity="info" sx={{ my: 1 }}>
                  An initial 40% interest charge is added when the loan is issued. If any balance remains
                  8 days after the first scheduled payment date, one additional 40% charge is applied
                  to that remaining balance. This additional charge is applied once only and does not repeat.
                  {Number(publicOffer.offer_term_months) === 2
                    ? " The two monthly instalments are equal."
                    : ""}
                </Alert>
                <Typography><strong>First payment date:</strong> {publicOffer.preferred_payment_date ? new Date(`${publicOffer.preferred_payment_date}T00:00:00`).toLocaleDateString("en-ZA") : "To be confirmed"}</Typography>
                <Typography><strong>Total repayment:</strong> R {Number(publicOffer.offer_total_repayment || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</Typography>
                <Typography><strong>Term:</strong> {publicOffer.offer_term_months} month(s)</Typography>
                <Typography><strong>Monthly instalment:</strong> R {Number(publicOffer.offer_monthly_repayment || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</Typography>
                <Typography variant="caption" color="text.secondary">Quotation expires: {publicOffer.offer_expires_at ? new Date(publicOffer.offer_expires_at).toLocaleString("en-ZA") : "Not specified"}</Typography>
                <Divider sx={{ my: 2 }} />
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input type="checkbox" checked={acceptanceChecked} onChange={(event) => setAcceptanceChecked(event.target.checked)} />
                  <span>I have read and accept the Pre-Agreement Statement and Loan Quotation, including the amount, interest, total repayment and instalment schedule.</span>
                </label>
                <Button fullWidth variant="contained" sx={{ mt: 2 }} disabled={(!acceptanceChecked && publicOffer?.offer_status !== "ACCEPTED") || offerFinalizing} onClick={handleAcceptPublicOffer}>
                  {offerFinalizing ? "Preparing final agreement..." : publicOffer?.offer_status === "ACCEPTED" ? "Continue to Final Agreement" : "Accept Quotation and Prepare Agreement"}
                </Button>
                <Button fullWidth color="error" sx={{ mt: 1 }} disabled={offerFinalizing} onClick={handleDeclinePublicOffer}>Decline Quotation and Cancel</Button>
              </Paper>
            )}
            {(agreementUrl || publicOffer?.signing_token) && (
              <Alert severity="success" sx={{ mt: 2 }}>
                Your loan has been created and the final agreement is ready. <a href={agreementUrl || `/sign-agreement/${publicOffer.signing_token}`}>Open and sign your loan agreement</a>.
              </Alert>
            )}
            {affordabilityAssessment && (
              <Box sx={{ mt: 3, textAlign: "left" }}>
                <Alert severity={affordabilityAssessment.status === "AFFORDABLE" ? "success" : "error"}>
                  <strong>Automatic affordability assessment: {affordabilityAssessment.status === "AFFORDABLE" ? "Passed" : "Not passed"}</strong>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Monthly expenses: R {Number(affordabilityAssessment.monthly_expenses || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    <br />
                    Disposable income: R {Number(affordabilityAssessment.disposable_income || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    <br />
                    Proposed monthly instalment: R {Number(affordabilityAssessment.monthly_repayment || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </Typography>
                  {affordabilityAssessment.status !== "AFFORDABLE" && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {affordabilityAssessment.reason || "The proposed repayment is not affordable based on the income and expenses supplied."}
                    </Typography>
                  )}
                </Alert>
                {affordabilityAssessment.status === "AFFORDABLE" && fundingAssessment?.sufficient === false && fundingAssessment?.reason !== "NOT_AFFORDABLE" && applicationId && uploadToken && !fundingBookingComplete && !["ISSUED", "ACCEPTED", "FINALIZED"].includes(publicOffer?.offer_status) && (
                  <Box sx={{ mt: 2 }}>
                    <Typography fontWeight="bold" sx={{ mb: 1 }}>Funding is subject to available company funds.</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      The available company balance after existing reservations is R {Number(fundingAssessment.available_funds || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}. Your requested amount is R {Number(fundingAssessment.requested_amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}. The shortfall is R {Number(fundingAssessment.shortfall || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}. You may wait for funds or select a future funding date.
                    </Typography>
                    <Button variant="contained" fullWidth sx={{ mb: 1 }} disabled={loading}
                      onClick={() => handleFundingBooking("WAIT")}>Wait for Funds</Button>
                    <TextField fullWidth type="date" label="Preferred Funding Date" InputLabelProps={{ shrink: true }}
                      value={preferredFundingDate} onChange={(event) => setPreferredFundingDate(event.target.value)}
                      sx={{ mb: 1 }} />
                    <Button variant="outlined" fullWidth disabled={loading || !preferredFundingDate}
                      onClick={() => handleFundingBooking("BOOK")}>Book a Future Date</Button>
                    <Button color="error" fullWidth disabled={loading} onClick={handleCancelFundingRequest} sx={{ mt: 1 }}>
                      Cancel Application
                    </Button>
                  </Box>
                )}
                {fundingBookingComplete && (
                  <Alert severity="info" sx={{ mt: 2 }}>{fundingBookingMessage}</Alert>
                )}
              </Box>
            )}

            {!pendingSync &&
              applicationId &&
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
            Umhlomunye Finance
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
                  type="password"
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
                  severity={
                    !navigator.onLine
                      ? "warning"
                      : "info"
                  }
                  icon={
                    !navigator.onLine ? (
                      undefined
                    ) : (
                      <PersonAddIcon />
                    )
                  }
                  sx={{ mt: 2 }}
                >
                  <strong>
                    {!navigator.onLine
                      ? "Offline application."
                      : "New customer application."}
                  </strong>{" "}
                  {!navigator.onLine
                    ? "The ID number will be checked when the application synchronizes with the server."
                    : "Please complete your personal, employment and banking information below."}
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

          {resumeApplication && (
            <Paper variant="outlined" sx={{ p: 3, mb: 3, borderColor: "primary.main" }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Unfinished quotation found
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                Application {resumeApplication.application_number} has an unfinished quotation for R {Number(resumeApplication.offer_amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}. You can continue with the same application or cancel it and start again.
              </Typography>
              <Button fullWidth variant="contained" disabled={loading} onClick={handleContinuePreviousApplication} sx={{ mb: 1 }}>
                {loading ? "Opening..." : "Continue where I left off"}
              </Button>
              <Button fullWidth color="error" variant="outlined" disabled={loading} onClick={handleStartNewApplication}>
                Cancel previous quotation and start a new application
              </Button>
            </Paper>
          )}

          {otpSent && (
            <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>Verify your identity</Typography>
              <Alert severity="info" sx={{ mb: 2 }}>We sent a six-digit code to {maskedOtpEmail}. The code expires in five minutes.</Alert>
              <TextField fullWidth label="Six-digit email code" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputProps={{ inputMode: "numeric", maxLength: 6 }} sx={{ mb: 2 }} />
              <Button variant="contained" onClick={handleVerifyOtp} disabled={otpVerifying || otpCode.length !== 6}>{otpVerifying ? "Verifying..." : "Verify and Continue"}</Button>
            </Paper>
          )}

          {idChecked && existingCustomer && !resumeApplication && !customerAction && (
            <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>What would you like to do?</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}><Button fullWidth variant="outlined" sx={{ minHeight: 76 }} onClick={() => setCustomerAction("new_loan")}>Apply for a New Loan</Button></Grid>
                <Grid item xs={12} md={4}><Button fullWidth variant="outlined" sx={{ minHeight: 76 }} disabled={!topUpEligibility?.has_open_loan || Number(topUpEligibility?.maximum_top_up || 0) <= 0} onClick={() => setCustomerAction("topup")}>Apply for a Top-Up Loan</Button></Grid>
                <Grid item xs={12} md={4}><Button fullWidth variant="outlined" sx={{ minHeight: 76 }} onClick={() => setCustomerAction("credit_limit")}>Request Credit-Limit Increase</Button></Grid>
              </Grid>
              {!topUpEligibility?.has_open_loan && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Top-up is available only when you have an active loan.</Typography>}
            </Paper>
          )}

          {idChecked && existingCustomer && customerAction === "credit_limit" && (
            <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>Request a Credit-Limit Increase</Typography>
              <Alert severity="info" sx={{ mb: 2 }}>Your request will be sent to the administrator for review. Your latest payslip is required. Your current credit limit is {formatCurrency(Number(topUpEligibility?.credit_limit || 0))}.</Alert>
              <TextField fullWidth type="number" label="Requested Credit Limit (R)" value={requestedCreditLimit} onChange={(event) => setRequestedCreditLimit(event.target.value)} inputProps={{ min: 1, max: 6000, step: "0.01" }} sx={{ mb: 2 }} />
              <TextField fullWidth multiline minRows={3} label="Reason for the increase" value={creditLimitReason} onChange={(event) => setCreditLimitReason(event.target.value)} sx={{ mb: 2 }} />
              <Button component="label" variant="outlined" sx={{ mb: 2 }}>Upload Latest Payslip<input hidden type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setCreditLimitPayslip(event.target.files?.[0] || null)} /></Button>
              {creditLimitPayslip && <Typography variant="body2" sx={{ mb: 2 }}>{creditLimitPayslip.name} ({(creditLimitPayslip.size / 1048576).toFixed(2)} MB)</Typography>}
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button variant="contained" onClick={handleSubmitCreditLimitRequest} disabled={creditLimitSubmitting}>{creditLimitSubmitting ? "Submitting..." : "Submit Request for Approval"}</Button>
                <Button onClick={() => setCustomerAction("")}>Back</Button>
              </Box>
              {creditLimitRequestResult && <Alert severity="success" sx={{ mt: 2 }}>Your credit-limit increase request has been submitted to the administrator for approval.</Alert>}
            </Paper>
          )}

          {/* =====================================================
              EVERYTHING BELOW ID CHECK
          ===================================================== */}

          {idChecked && existingCustomer && !resumeApplication && customerAction === "topup" && (
            <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>Apply for a Top-Up Loan</Typography>
              <Alert severity="info" sx={{ mb: 2 }}>
                Your available top-up is based on your approved credit limit less your outstanding principal. Interest and fees are not included in this calculation.
              </Alert>
              <Typography sx={{ mb: 1 }}>
                <strong>Maximum available top-up: {formatCurrency(Number(topUpEligibility.maximum_top_up || 0))}</strong>
              </Typography>
              {Number(topUpEligibility.maximum_top_up || 0) <= 0 ? (
                <Alert severity="warning">You currently have no available credit for a top-up.</Alert>
              ) : (
                <>
                  <TextField
                    fullWidth
                    type="number"
                    label="Top-Up Amount"
                    value={topUpAmount}
                    onChange={(event) => { setTopUpAmount(event.target.value); setError(""); setTopUpResult(null); }}
                    inputProps={{ min: 0.01, max: Number(topUpEligibility.maximum_top_up), step: "0.01" }}
                    helperText={`Maximum you may apply for: ${formatCurrency(Number(topUpEligibility.maximum_top_up))}`}
                    sx={{ mb: 2 }}
                    disabled={loading || Boolean(topUpResult)}
                  />
                  {Number(topUpAmount) > Number(topUpEligibility.maximum_top_up) && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      Your requested top-up is above your available credit limit. Maximum top-up amount: {formatCurrency(Number(topUpEligibility.maximum_top_up))}. Please enter an amount equal to or below {formatCurrency(Number(topUpEligibility.maximum_top_up))}.
                    </Alert>
                  )}
                  <Button
                    variant="contained"
                    onClick={handleSubmitTopUp}
                    disabled={loading || !topUpAmount || Number(topUpAmount) <= 0 || Number(topUpAmount) > Number(topUpEligibility.maximum_top_up) || Boolean(topUpResult)}
                  >
                    {loading ? "Submitting..." : "Submit Top-Up"}
                  </Button>
                </>
              )}
              {topUpResult && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  Your top-up has passed the credit-limit and affordability checks and has been automatically approved. Funding status: {topUpResult.funding_status === "FUNDED" ? "Funds have been released." : "Your approved top-up is waiting for company funds."}
                </Alert>
              )}
            </Paper>
          )}

          {idChecked && !resumeApplication && (!existingCustomer || customerAction === "new_loan") && (
            <form
              noValidate
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
                    required
                    type="tel"
                    label="Cellphone"
                    name="cellphone"
                    value={form.cellphone}
                    onChange={handleChange}
                    inputProps={{
                      inputMode: "numeric",
                      pattern: "0[0-9]{9}",
                      maxLength: 10,
                    }}
                    helperText="Enter a 10-digit cellphone number, e.g. 0821234567"
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
                    type="email"
                    label="Email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    helperText="Required"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    required
                    multiline
                    rows={2}
                    label="Physical Address"
                    name="physical_address"
                    value={form.physical_address}
                    onChange={handleChange}
                    helperText="Required"
                  />
                </Grid>
              </Grid>

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
                      sm={5}
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
                      sm={7}
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
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        required
                        multiline
                        rows={2}
                        label="Work Address"
                        name="work_address"
                        value={form.work_address}
                        onChange={handleChange}
                        helperText="Required"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        required
                        type="tel"
                        label="Work Telephone Number"
                        name="work_telephone"
                        value={form.work_telephone}
                        onChange={handleChange}
                        inputProps={{ inputMode: "numeric", pattern: "0[0-9]{9}", maxLength: 10 }}
                        helperText="Enter a 10-digit work number, e.g. 0111234567"
                      />
                    </Grid>
                  </Grid>
                </>

              <Divider sx={{ my: 4 }} />

              {/* =================================================
                  MONTHLY INCOME AND EXPENSES
              ================================================= */}
              <Typography variant="h6" sx={{ mb: 2 }} fontWeight="bold">
                Monthly Income and Expenses
              </Typography>
              <Alert severity="info" sx={{ mb: 2 }}>
                Please provide your monthly income and regular expenses. These figures are used to calculate your disposable income and assess whether the proposed instalment is affordable. Supporting documents are optional.
              </Alert>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth required type="number" label="Monthly Income" name="monthly_income"
                    value={form.monthly_income} onChange={handleChange}
                    helperText={existingCustomer && form.monthly_income !== ""
                      ? "Your saved monthly income has been loaded. You can edit it if it has changed, or leave it as is."
                      : "Enter your current monthly income."}
                    inputProps={{ min: 0, step: "0.01" }} InputProps={{ startAdornment: "R " }} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth type="number" label="Other Monthly Income" name="other_income"
                    value={form.other_income} onChange={handleChange}
                    inputProps={{ min: 0, step: "0.01" }} InputProps={{ startAdornment: "R " }} />
                </Grid>
              </Grid>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 3, mb: 1 }}>
                Monthly Expenses
              </Typography>
              {expenses.map((item, index) => (
                <Grid container spacing={1} key={item.category} sx={{ mb: 1 }} alignItems="center">
                  <Grid item xs={12} sm={6}>
                    <Typography fontWeight={500}>{item.category}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      required
                      type="number"
                      label={`Monthly Amount - ${item.category}`}
                      value={item.monthly_amount}
                      onChange={(event) => setExpenses((current) => current.map((expense, expenseIndex) =>
                        expenseIndex === index ? { ...expense, monthly_amount: event.target.value } : expense
                      ))}
                      inputProps={{ min: 0, step: "0.01" }}
                      InputProps={{ startAdornment: "R " }}
                      helperText="Enter R0 if this category does not apply"
                    />
                  </Grid>
                </Grid>
              ))}
              <Box sx={{ mt: 2, p: 2, bgcolor: "grey.100", borderRadius: 1 }}>
                <Typography variant="body2">Total Monthly Expenses: <strong>R {monthlyExpenseTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></Typography>
                <Typography variant="body2">Estimated Disposable Income: <strong>R {(Number(form.monthly_income || 0) + Number(form.other_income || 0) - monthlyExpenseTotal).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></Typography>
              </Box>

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
                <Grid item xs={12}>
                  <Typography fontWeight="bold" sx={{ mb: 1 }}>
                    Choose your loan amount
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" color="primary" sx={{ mb: 1 }}>
                    {formatCurrency(selectedLoanAmount)}
                  </Typography>
                  <Slider
                    value={selectedLoanAmount}
                    min={100}
                    max={6000}
                    step={1}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(value) => formatCurrency(value)}
                    onChange={(_, value) => {
                      setForm((previous) => ({
                        ...previous,
                        amount_requested: String(value),
                      }));
                      setSelectedTermMonths(value >= 5000 ? 2 : 1);
                      setError("");
                    }}
                    aria-label="Loan amount"
                  />
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">R100</Typography>
                    <Typography variant="caption" color="text.secondary">R6,000 maximum</Typography>
                  </Box>
                  <TextField
                    fullWidth
                    required
                    type="number"
                    label="Amount Requested"
                    name="amount_requested"
                    value={form.amount_requested}
                    onChange={handleChange}
                    inputProps={{ min: 100, max: 6000, step: "0.01" }}
                    InputProps={{ startAdornment: "R " }}
                    helperText="Move the slider or enter an exact amount."
                  />
                </Grid>

                {selectedLoanAmount >= 5000 && (
                  <Grid item xs={12}>
                    <Typography fontWeight="bold" sx={{ mb: 1 }}>
                      Choose your repayment term
                    </Typography>
                    <RadioGroup
                      row
                      value={String(selectedLoanTerm)}
                      onChange={(event) => setSelectedTermMonths(Number(event.target.value))}
                    >
                      <FormControlLabel value="1" control={<Radio />} label="1 month" />
                      <FormControlLabel value="2" control={<Radio />} label="2 months (equal instalments)" />
                    </RadioGroup>
                  </Grid>
                )}

                <Grid item xs={12}>
                  <Paper variant="outlined" sx={{ p: 2, backgroundColor: "#f8fafc" }}>
                    <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>
                      Your repayment quotation
                    </Typography>
                    <Grid container spacing={1}>
                      <Grid item xs={7}><Typography color="text.secondary">Loan amount</Typography></Grid>
                      <Grid item xs={5}><Typography textAlign="right" fontWeight="medium">{formatCurrency(selectedLoanAmount)}</Typography></Grid>
                      <Grid item xs={7}><Typography color="text.secondary">Initial interest (40%)</Typography></Grid>
                      <Grid item xs={5}><Typography textAlign="right" fontWeight="medium">{formatCurrency(initialLoanInterest)}</Typography></Grid>
                      {selectedLoanTerm === 2 && (
                        <>
                          <Grid item xs={7}><Typography color="text.secondary">Day-8 interest on remaining balance (40%)</Typography></Grid>
                          <Grid item xs={5}><Typography textAlign="right" fontWeight="medium">{formatCurrency(displayedDayEightInterest)}</Typography></Grid>
                        </>
                      )}
                      <Grid item xs={7}><Typography color="text.secondary">Repayment term</Typography></Grid>
                      <Grid item xs={5}><Typography textAlign="right" fontWeight="medium">{selectedLoanTerm} month(s)</Typography></Grid>
                      <Grid item xs={7}><Typography color="text.secondary">Instalment{selectedLoanTerm === 2 ? " (each)" : ""}</Typography></Grid>
                      <Grid item xs={5}><Typography textAlign="right" fontWeight="bold" color="primary.main">{formatCurrency(displayedInstalment)}</Typography></Grid>
                      <Grid item xs={7}><Typography fontWeight="bold">Total repayment</Typography></Grid>
                      <Grid item xs={5}><Typography textAlign="right" fontWeight="bold">{formatCurrency(displayedTotalRepayment)}</Typography></Grid>
                    </Grid>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                      The 40% initial interest is added when the loan is issued. For 2-month loans, one additional 40% charge is applied to the outstanding balance 8 days after the first scheduled payment date. The two instalments are calculated to be equal, subject to cent rounding.
                    </Typography>
                  </Paper>
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
                Supporting Documents (Optional)
              </Typography>

              <Alert
                severity={
                  navigator.onLine
                    ? "info"
                    : "warning"
                }
                sx={{ mb: 2 }}
              >
                Supporting documents are optional. You may upload documents such as your ID, bank statement, payslip or proof of residence, but you can submit your application without uploading any files. PDF, JPG and PNG
                files are accepted. Maximum{" "}
                {MAX_FILES} files, 10 MB per
                file.
                {!navigator.onLine && (
                  <>
                    {" "}
                    You are currently offline;
                    selected documents will be
                    saved on this device and
                    synchronized when internet
                    access returns.
                  </>
                )}
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
                    ? "Saving..."
                    : !navigator.onLine
                    ? "Save Application Offline"
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