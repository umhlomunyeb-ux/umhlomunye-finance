import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import DescriptionIcon from "@mui/icons-material/Description";
import PersonIcon from "@mui/icons-material/Person";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import BusinessIcon from "@mui/icons-material/Business";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";

import {
  getDocuments,
  openDocument,
  archiveDocument,
  restoreDocument,
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  DOCUMENT_VERIFICATION_STATUSES,
  DOCUMENT_RETENTION_STATUSES,
} from "../../services/documentService";

/**
 * ============================================================
 * FORMATTERS
 * ============================================================
 */

function formatFileSize(bytes) {
  if (
    bytes === null ||
    bytes === undefined ||
    Number.isNaN(Number(bytes))
  ) {
    return "—";
  }

  const size = Number(bytes);

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatDocumentType(value) {
  if (!value) {
    return "—";
  }

  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCategory(value) {
  if (!value) {
    return "—";
  }

  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatStatus(value) {
  if (!value) {
    return "—";
  }

  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * ============================================================
 * DOCUMENT CLASSIFICATION
 * ============================================================
 *
 * Customer and loan documents are uploaded from the loan
 * application / new-loan workflow.
 *
 * This page only manages and displays them.
 */

function getDocumentOrigin(document) {
  if (!document) {
    return {
      label: "Other",
      icon: <DescriptionIcon fontSize="small" />,
    };
  }

  if (
    document.customer_id ||
    document.customer_id_number_snapshot
  ) {
    if (
      document.document_category ===
      DOCUMENT_CATEGORIES.CUSTOMER
    ) {
      return {
        label: "Customer",
        icon: <PersonIcon fontSize="small" />,
      };
    }
  }

  if (
    document.loan_id ||
    document.loan_number_snapshot
  ) {
    return {
      label: "Loan",
      icon: <AccountBalanceIcon fontSize="small" />,
    };
  }

  if (
    document.company_name_snapshot ||
    document.document_category ===
      DOCUMENT_CATEGORIES.COMPANY
  ) {
    return {
      label: "Company",
      icon: <BusinessIcon fontSize="small" />,
    };
  }

  if (
    document.borrowing_id ||
    document.document_category ===
      DOCUMENT_CATEGORIES.BORROWING
  ) {
    return {
      label: "Borrowing",
      icon: <ReceiptLongIcon fontSize="small" />,
    };
  }

  if (
    document.debt_repayment_id ||
    document.document_category ===
      DOCUMENT_CATEGORIES.DEBT_REPAYMENT
  ) {
    return {
      label: "Debt Repayment",
      icon: <ReceiptLongIcon fontSize="small" />,
    };
  }

  if (
    document.document_category ===
    DOCUMENT_CATEGORIES.FINANCIAL_RECORD
  ) {
    return {
      label: "Financial Record",
      icon: <DescriptionIcon fontSize="small" />,
    };
  }

  return {
    label: "Other",
    icon: <DescriptionIcon fontSize="small" />,
  };
}

/**
 * ============================================================
 * REFERENCE
 * ============================================================
 */

function getReference(document) {
  if (document?.loan_number_snapshot) {
    return {
      label: "Loan",
      value: document.loan_number_snapshot,
    };
  }

  if (document?.customer_id_number_snapshot) {
    return {
      label: "ID Number",
      value: document.customer_id_number_snapshot,
    };
  }

  if (document?.company_name_snapshot) {
    return {
      label: "Company",
      value: document.company_name_snapshot,
    };
  }

  if (document?.application_id) {
    return {
      label: "Application",
      value: document.application_id,
    };
  }

  if (document?.borrowing_id) {
    return {
      label: "Borrowing",
      value: document.borrowing_id,
    };
  }

  if (document?.debt_repayment_id) {
    return {
      label: "Repayment",
      value: document.debt_repayment_id,
    };
  }

  return null;
}

/**
 * ============================================================
 * STATUS COLORS
 * ============================================================
 */

function getVerificationColor(status) {
  switch (status) {
    case DOCUMENT_VERIFICATION_STATUSES.VERIFIED:
    case DOCUMENT_VERIFICATION_STATUSES.PASSED:
      return "success";

    case DOCUMENT_VERIFICATION_STATUSES.REJECTED:
    case DOCUMENT_VERIFICATION_STATUSES.HIGH_RISK:
      return "error";

    case DOCUMENT_VERIFICATION_STATUSES.REVIEW_REQUIRED:
      return "warning";

    case DOCUMENT_VERIFICATION_STATUSES.PROCESSING:
      return "info";

    default:
      return "default";
  }
}

function getRetentionColor(status) {
  switch (status) {
    case DOCUMENT_RETENTION_STATUSES.ACTIVE:
      return "success";

    case DOCUMENT_RETENTION_STATUSES.EXPIRING_SOON:
      return "warning";

    case DOCUMENT_RETENTION_STATUSES.EXPIRED:
      return "error";

    case DOCUMENT_RETENTION_STATUSES.ARCHIVED:
      return "default";

    default:
      return "default";
  }
}

/**
 * ============================================================
 * MAIN COMPONENT
 * ============================================================
 */

export default function Documents() {
  const [documents, setDocuments] = useState([]);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [verificationStatus, setVerificationStatus] =
    useState("");
  const [retentionStatus, setRetentionStatus] =
    useState("");

  /**
   * Additional management filters.
   *
   * These filter the already retrieved document records and
   * therefore do not require any database changes.
   */
  const [recordType, setRecordType] = useState("");

  const [includeArchived, setIncludeArchived] =
    useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [actionLoading, setActionLoading] =
    useState(null);

  /**
   * ==========================================================
   * LOAD DOCUMENTS
   * ==========================================================
   */

  const loadDocuments = useCallback(
    async ({
      showLoading = true,
      showRefreshing = false,
    } = {}) => {
      try {
        setError("");

        if (showLoading) {
          setLoading(true);
        }

        if (showRefreshing) {
          setRefreshing(true);
        }

        const data = await getDocuments({
          category: category || null,
          documentType: documentType || null,
          verificationStatus:
            verificationStatus || null,
          retentionStatus:
            retentionStatus || null,
          includeArchived,
          search: search.trim(),
        });

        setDocuments(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(
          "Documents: failed to load documents:",
          err
        );

        setError(
          err?.message ||
            "Unable to load documents."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      category,
      documentType,
      verificationStatus,
      retentionStatus,
      includeArchived,
      search,
    ]
  );

  /**
   * ==========================================================
   * AUTOMATIC SEARCH/FILTER REFRESH
   * ==========================================================
   */

  useEffect(() => {
    const timer = setTimeout(() => {
      loadDocuments({
        showLoading: true,
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [loadDocuments]);

  /**
   * ==========================================================
   * LOCAL RECORD-TYPE FILTER
   * ==========================================================
   */

  const filteredDocuments = useMemo(() => {
    if (!recordType) {
      return documents;
    }

    return documents.filter((document) => {
      const origin = getDocumentOrigin(document);

      return origin.label === recordType;
    });
  }, [documents, recordType]);

  /**
   * ==========================================================
   * SUMMARY
   * ==========================================================
   */

  const activeDocumentCount = useMemo(
    () =>
      filteredDocuments.filter(
        (document) => !document.is_archived
      ).length,
    [filteredDocuments]
  );

  const archivedDocumentCount = useMemo(
    () =>
      filteredDocuments.filter(
        (document) => document.is_archived
      ).length,
    [filteredDocuments]
  );

  const totalStorageBytes = useMemo(
    () =>
      filteredDocuments.reduce(
        (total, document) =>
          total +
          (Number(document.file_size_bytes) || 0),
        0
      ),
    [filteredDocuments]
  );

  /**
   * ==========================================================
   * OPEN
   * ==========================================================
   */

  async function handleOpenDocument(document) {
    try {
      setActionLoading(
        `open-${document.id}`
      );

      setError("");

      await openDocument(document);
    } catch (err) {
      console.error(
        "Documents: unable to open document:",
        err
      );

      setError(
        err?.message ||
          "Unable to open this document."
      );
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * ==========================================================
   * ARCHIVE
   * ==========================================================
   */

  async function handleArchive(document) {
    try {
      setActionLoading(
        `archive-${document.id}`
      );

      setError("");

      await archiveDocument(document.id);

      await loadDocuments({
        showLoading: false,
        showRefreshing: false,
      });
    } catch (err) {
      console.error(
        "Documents: unable to archive document:",
        err
      );

      setError(
        err?.message ||
          "Unable to archive this document."
      );
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * ==========================================================
   * RESTORE
   * ==========================================================
   */

  async function handleRestore(document) {
    try {
      setActionLoading(
        `restore-${document.id}`
      );

      setError("");

      await restoreDocument(document.id);

      await loadDocuments({
        showLoading: false,
        showRefreshing: false,
      });
    } catch (err) {
      console.error(
        "Documents: unable to restore document:",
        err
      );

      setError(
        err?.message ||
          "Unable to restore this document."
      );
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * ==========================================================
   * CLEAR FILTERS
   * ==========================================================
   */

  function handleClearFilters() {
    setSearch("");
    setCategory("");
    setDocumentType("");
    setVerificationStatus("");
    setRetentionStatus("");
    setRecordType("");
    setIncludeArchived(false);
  }

  /**
   * ==========================================================
   * RENDER
   * ==========================================================
   */

  return (
    <Box sx={{ width: "100%" }}>
      {/* =====================================================
          HEADER
      ====================================================== */}

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: {
            xs: "flex-start",
            md: "center",
          },
          gap: 2,
          mb: 3,
          flexDirection: {
            xs: "column",
            md: "row",
          },
        }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight={700}
          >
            Documents
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            Central document management for
            customer, loan, company, financial
            and other business records.
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 0.5,
            }}
          >
            Customer and loan documents are
            uploaded from the loan application
            workflow.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={
            refreshing ? (
              <CircularProgress size={18} />
            ) : (
              <RefreshIcon />
            )
          }
          onClick={() =>
            loadDocuments({
              showLoading: false,
              showRefreshing: true,
            })
          }
          disabled={loading || refreshing}
        >
          Refresh
        </Button>
      </Box>

      {/* =====================================================
          SUMMARY
      ====================================================== */}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(4, 1fr)",
          },
          gap: 2,
          mb: 3,
        }}
      >
        <Paper
          variant="outlined"
          sx={{ p: 2 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Documents shown
          </Typography>

          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ mt: 0.5 }}
          >
            {filteredDocuments.length}
          </Typography>
        </Paper>

        <Paper
          variant="outlined"
          sx={{ p: 2 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Active documents
          </Typography>

          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ mt: 0.5 }}
          >
            {activeDocumentCount}
          </Typography>
        </Paper>

        <Paper
          variant="outlined"
          sx={{ p: 2 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Archived
          </Typography>

          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ mt: 0.5 }}
          >
            {archivedDocumentCount}
          </Typography>
        </Paper>

        <Paper
          variant="outlined"
          sx={{ p: 2 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Storage shown
          </Typography>

          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ mt: 0.5 }}
          >
            {formatFileSize(totalStorageBytes)}
          </Typography>
        </Paper>
      </Box>

      {/* =====================================================
          ERROR
      ====================================================== */}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      {/* =====================================================
          FILTERS
      ====================================================== */}

      <Paper
        variant="outlined"
        sx={{ p: 2, mb: 3 }}
      >
        <Typography
          variant="subtitle1"
          fontWeight={700}
          sx={{ mb: 2 }}
        >
          Search & Filters
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              lg: "2fr repeat(5, 1fr) auto",
            },
            gap: 2,
            alignItems: "center",
          }}
        >
          {/* SEARCH */}

          <TextField
            fullWidth
            size="small"
            label="Search documents"
            placeholder="Name, ID number, loan number..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          {/* RECORD TYPE */}

          <FormControl
            fullWidth
            size="small"
          >
            <InputLabel>
              Record
            </InputLabel>

            <Select
              value={recordType}
              label="Record"
              onChange={(event) =>
                setRecordType(event.target.value)
              }
            >
              <MenuItem value="">
                All Records
              </MenuItem>

              <MenuItem value="Customer">
                Customer
              </MenuItem>

              <MenuItem value="Loan">
                Loan
              </MenuItem>

              <MenuItem value="Company">
                Company
              </MenuItem>

              <MenuItem value="Borrowing">
                Borrowing
              </MenuItem>

              <MenuItem value="Debt Repayment">
                Debt Repayment
              </MenuItem>

              <MenuItem value="Financial Record">
                Financial Record
              </MenuItem>

              <MenuItem value="Other">
                Other
              </MenuItem>
            </Select>
          </FormControl>

          {/* CATEGORY */}

          <FormControl
            fullWidth
            size="small"
          >
            <InputLabel>
              Category
            </InputLabel>

            <Select
              value={category}
              label="Category"
              onChange={(event) =>
                setCategory(event.target.value)
              }
            >
              <MenuItem value="">
                All Categories
              </MenuItem>

              {Object.values(
                DOCUMENT_CATEGORIES
              ).map((value) => (
                <MenuItem
                  key={value}
                  value={value}
                >
                  {formatCategory(value)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* DOCUMENT TYPE */}

          <FormControl
            fullWidth
            size="small"
          >
            <InputLabel>
              Document Type
            </InputLabel>

            <Select
              value={documentType}
              label="Document Type"
              onChange={(event) =>
                setDocumentType(
                  event.target.value
                )
              }
            >
              <MenuItem value="">
                All Types
              </MenuItem>

              {Object.values(
                DOCUMENT_TYPES
              ).map((value) => (
                <MenuItem
                  key={value}
                  value={value}
                >
                  {formatDocumentType(value)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* VERIFICATION */}

          <FormControl
            fullWidth
            size="small"
          >
            <InputLabel>
              Verification
            </InputLabel>

            <Select
              value={verificationStatus}
              label="Verification"
              onChange={(event) =>
                setVerificationStatus(
                  event.target.value
                )
              }
            >
              <MenuItem value="">
                All Verification
              </MenuItem>

              {Object.values(
                DOCUMENT_VERIFICATION_STATUSES
              ).map((value) => (
                <MenuItem
                  key={value}
                  value={value}
                >
                  {formatStatus(value)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* RETENTION */}

          <FormControl
            fullWidth
            size="small"
          >
            <InputLabel>
              Retention
            </InputLabel>

            <Select
              value={retentionStatus}
              label="Retention"
              onChange={(event) =>
                setRetentionStatus(
                  event.target.value
                )
              }
            >
              <MenuItem value="">
                All Retention
              </MenuItem>

              {Object.values(
                DOCUMENT_RETENTION_STATUSES
              ).map((value) => (
                <MenuItem
                  key={value}
                  value={value}
                >
                  {formatStatus(value)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* CLEAR */}

          <Button
            variant="text"
            onClick={handleClearFilters}
            sx={{
              whiteSpace: "nowrap",
            }}
          >
            Clear
          </Button>
        </Box>

        {/* ARCHIVED */}

        <Box sx={{ mt: 2 }}>
          <Button
            variant={
              includeArchived
                ? "contained"
                : "outlined"
            }
            size="small"
            onClick={() =>
              setIncludeArchived(
                (current) => !current
              )
            }
          >
            {includeArchived
              ? "Showing Archived"
              : "Include Archived"}
          </Button>
        </Box>
      </Paper>

      {/* =====================================================
          DOCUMENT TABLE
      ====================================================== */}

      <Paper
        variant="outlined"
        sx={{
          overflow: "hidden",
        }}
      >
        {loading ? (
          <Box
            sx={{
              minHeight: 300,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <CircularProgress />

            <Typography
              variant="body2"
              color="text.secondary"
            >
              Loading documents...
            </Typography>
          </Box>
        ) : filteredDocuments.length === 0 ? (
          <Box
            sx={{
              minHeight: 300,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 1,
              p: 3,
            }}
          >
            <DescriptionIcon
              sx={{
                fontSize: 48,
                color: "text.secondary",
              }}
            />

            <Typography
              variant="h6"
              fontWeight={600}
            >
              No documents found
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
              textAlign="center"
            >
              There are no documents matching
              the current search and filters.
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table
              size="small"
              sx={{
                minWidth: 1250,
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>
                    <strong>Document</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Type</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Record</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Category</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Reference</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Size</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Created</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Verification</strong>
                  </TableCell>

                  <TableCell>
                    <strong>Retention</strong>
                  </TableCell>

                  <TableCell align="right">
                    <strong>Actions</strong>
                  </TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {filteredDocuments.map(
                  (document) => {
                    const reference =
                      getReference(document);

                    const origin =
                      getDocumentOrigin(
                        document
                      );

                    const opening =
                      actionLoading ===
                      `open-${document.id}`;

                    const archiving =
                      actionLoading ===
                      `archive-${document.id}`;

                    const restoring =
                      actionLoading ===
                      `restore-${document.id}`;

                    return (
                      <TableRow
                        key={document.id}
                        hover
                      >
                        {/* DOCUMENT */}

                        <TableCell>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems:
                                "center",
                              gap: 1,
                            }}
                          >
                            <DescriptionIcon
                              fontSize="small"
                              color="action"
                            />

                            <Box
                              sx={{
                                minWidth: 0,
                              }}
                            >
                              <Typography
                                variant="body2"
                                fontWeight={600}
                                sx={{
                                  wordBreak:
                                    "break-word",
                                }}
                              >
                                {document.document_name ||
                                  "Unnamed Document"}
                              </Typography>

                              {document.is_archived && (
                                <Chip
                                  label="Archived"
                                  size="small"
                                  sx={{
                                    mt: 0.5,
                                  }}
                                />
                              )}
                            </Box>
                          </Box>
                        </TableCell>

                        {/* TYPE */}

                        <TableCell>
                          {formatDocumentType(
                            document.document_type
                          )}
                        </TableCell>

                        {/* RECORD */}

                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            icon={origin.icon}
                            label={origin.label}
                          />
                        </TableCell>

                        {/* CATEGORY */}

                        <TableCell>
                          {formatCategory(
                            document.document_category
                          )}
                        </TableCell>

                        {/* REFERENCE */}

                        <TableCell>
                          {reference ? (
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {reference.label}
                              </Typography>

                              <Typography
                                variant="body2"
                                sx={{
                                  maxWidth: 220,
                                  wordBreak:
                                    "break-word",
                                }}
                              >
                                {reference.value}
                              </Typography>
                            </Box>
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* SIZE */}

                        <TableCell>
                          {formatFileSize(
                            document.file_size_bytes
                          )}
                        </TableCell>

                        {/* CREATED */}

                        <TableCell>
                          {formatDate(
                            document.created_at
                          )}
                        </TableCell>

                        {/* VERIFICATION */}

                        <TableCell>
                          <Chip
                            size="small"
                            label={formatStatus(
                              document.verification_status
                            )}
                            color={getVerificationColor(
                              document.verification_status
                            )}
                          />
                        </TableCell>

                        {/* RETENTION */}

                        <TableCell>
                          <Chip
                            size="small"
                            label={formatStatus(
                              document.retention_status
                            )}
                            color={getRetentionColor(
                              document.retention_status
                            )}
                          />
                        </TableCell>

                        {/* ACTIONS */}

                        <TableCell align="right">
                          <Stack
                            direction="row"
                            spacing={0.5}
                            justifyContent="flex-end"
                          >
                            <Tooltip title="Open document">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() =>
                                    handleOpenDocument(
                                      document
                                    )
                                  }
                                  disabled={
                                    opening ||
                                    !document.document_path
                                  }
                                >
                                  {opening ? (
                                    <CircularProgress
                                      size={18}
                                    />
                                  ) : (
                                    <VisibilityIcon fontSize="small" />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>

                            {!document.is_archived ? (
                              <Tooltip title="Archive document">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() =>
                                      handleArchive(
                                        document
                                      )
                                    }
                                    disabled={
                                      archiving
                                    }
                                  >
                                    {archiving ? (
                                      <CircularProgress
                                        size={18}
                                      />
                                    ) : (
                                      <ArchiveIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            ) : (
                              <Tooltip title="Restore document">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() =>
                                      handleRestore(
                                        document
                                      )
                                    }
                                    disabled={
                                      restoring
                                    }
                                  >
                                    {restoring ? (
                                      <CircularProgress
                                        size={18}
                                      />
                                    ) : (
                                      <UnarchiveIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  }
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
