import { useEffect, useMemo, useState } from "react";

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
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

import {
  getLoanSummary,
  getRecentLoanTransactions,
  subscribeToLoans,
  subscribeToLoanTransactions,
  removeLoanSubscription,
} from "../../services/loanService";

function money(value) {
  return `R${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-ZA");
}

function getCustomerName(transaction) {
  const customer = transaction?.loans?.customers;

  if (!customer) return "-";

  return `${customer.first_name || ""} ${
    customer.last_name || ""
  }`.trim();
}

function getPortfolioCustomerName(loan) {
  const customer = loan?.customers;

  if (!customer) return "-";

  return `${customer.first_name || ""} ${
    customer.last_name || ""
  }`.trim();
}

function StatCard({ title, value, subtitle }) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1 }}
        >
          {title}
        </Typography>

        <Typography variant="h5" fontWeight={700}>
          {value}
        </Typography>

        {subtitle && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 1,
            }}
          >
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState(0);

  const [search, setSearch] = useState("");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function loadReports() {
    try {
      setError("");

      const [loanSummary, recentTransactions] =
        await Promise.all([
          getLoanSummary(),
          getRecentLoanTransactions(500),
        ]);

      setSummary(loanSummary);
      setTransactions(recentTransactions);
    } catch (err) {
      console.error("REPORTS LOAD ERROR:", err);
      setError(
        err.message || "Unable to load reports."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();

    const loanChannel = subscribeToLoans(() => {
      loadReports();
    });

    const transactionChannel =
      subscribeToLoanTransactions(() => {
        loadReports();
      });

    return () => {
      removeLoanSubscription(loanChannel);
      removeLoanSubscription(transactionChannel);
    };
  }, []);

  const filteredTransactions = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    return transactions.filter((transaction) => {
      const loan = transaction?.loans;
      const customerName =
        getCustomerName(transaction);

      const searchableText = [
        loan?.loan_number,
        customerName,
        transaction?.transaction_type,
        transaction?.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        searchValue &&
        !searchableText.includes(searchValue)
      ) {
        return false;
      }

      if (dateFrom) {
        const transactionDate = new Date(
          transaction.transaction_date
        );

        const fromDate = new Date(
          `${dateFrom}T00:00:00`
        );

        if (transactionDate < fromDate) {
          return false;
        }
      }

      if (dateTo) {
        const transactionDate = new Date(
          transaction.transaction_date
        );

        const toDate = new Date(
          `${dateTo}T23:59:59`
        );

        if (transactionDate > toDate) {
          return false;
        }
      }

      return true;
    });
  }, [
    transactions,
    search,
    dateFrom,
    dateTo,
  ]);

  const interestTransactions = useMemo(
    () =>
      filteredTransactions.filter(
        (transaction) =>
          String(
            transaction.transaction_type
          ).toLowerCase() === "interest"
      ),
    [filteredTransactions]
  );

  const repaymentTransactions = useMemo(
    () =>
      filteredTransactions.filter(
        (transaction) =>
          String(
            transaction.transaction_type
          ).toLowerCase() === "payment"
      ),
    [filteredTransactions]
  );

  const reportInterest =
    interestTransactions.reduce(
      (sum, transaction) =>
        sum + Number(transaction.debit || 0),
      0
    );

  const reportRepayments =
    repaymentTransactions.reduce(
      (sum, transaction) =>
        sum + Number(transaction.credit || 0),
      0
    );

  const reportTitle = [
    "Transactions Report",
    "Repayments Report",
    "Interest Report",
    "Loan Portfolio Report",
  ][tab];

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
  }

  function exportCSV() {
    const rows = filteredTransactions.map(
      (transaction) => ({
        Date: formatDate(
          transaction.transaction_date
        ),

        "Loan Number":
          transaction?.loans?.loan_number || "",

        Customer:
          getCustomerName(transaction),

        Type:
          transaction.transaction_type || "",

        Description:
          transaction.description || "",

        Debit: Number(
          transaction.debit || 0
        ).toFixed(2),

        Credit: Number(
          transaction.credit || 0
        ).toFixed(2),

        Balance: Number(
          transaction.balance || 0
        ).toFixed(2),
      })
    );

    if (!rows.length) {
      alert(
        "There is no report data to export."
      );
      return;
    }

    const headers = Object.keys(rows[0]);

    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const value = String(
              row[header] ?? ""
            ).replace(/"/g, '""');

            return `"${value}"`;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;

    link.download =
      `umhlomunye-finance-report-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!summary) {
    return (
      <Alert severity="error">
        Unable to load the financial reports.
      </Alert>
    );
  }

  return (
    <>
      {/* =========================================================
          SCREEN REPORT
      ========================================================== */}

      <Box className="reports-screen">
        <Stack
          direction={{
            xs: "column",
            md: "row",
          }}
          justifyContent="space-between"
          alignItems={{
            xs: "flex-start",
            md: "center",
          }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography
              variant="h4"
              fontWeight={700}
            >
              Reports
            </Typography>

            <Typography color="text.secondary">
              Live financial and loan portfolio
              reporting
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={1}
          >
            <Button
              variant="outlined"
              onClick={printReport}
            >
              Print Report
            </Button>

            <Button
              variant="contained"
              onClick={exportCSV}
            >
              Export CSV
            </Button>
          </Stack>
        </Stack>

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
          >
            {error}
          </Alert>
        )}

        {/* SUMMARY */}
        <Grid
          container
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Total Loans"
              value={summary.totalLoans}
              subtitle="All active and completed loans"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Active Loans"
              value={summary.activeLoanCount}
              subtitle="Currently outstanding"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Total Principal"
              value={money(
                summary.totalPrincipal
              )}
              subtitle="Principal issued"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Outstanding Balance"
              value={money(
                summary.totalBalance
              )}
              subtitle="Current active balance"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Total Paid"
              value={money(summary.totalPaid)}
              subtitle="Repayments recorded"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Loan Interest"
              value={money(
                summary.totalInterest
              )}
              subtitle="Interest configured on loans"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Report Repayments"
              value={money(
                reportRepayments
              )}
              subtitle="Filtered payment transactions"
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: 3,
            }}
          >
            <StatCard
              title="Report Interest"
              value={money(reportInterest)}
              subtitle="Filtered interest transactions"
            />
          </Grid>
        </Grid>

        {/* FILTERS */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{ mb: 2 }}
            >
              Report Filters
            </Typography>

            <Grid
              container
              spacing={2}
            >
              <Grid
                size={{
                  xs: 12,
                  md: 4,
                }}
              >
                <TextField
                  fullWidth
                  label="Search"
                  placeholder="Loan number, customer, type..."
                  value={search}
                  onChange={(e) =>
                    setSearch(e.target.value)
                  }
                />
              </Grid>

              <Grid
                size={{
                  xs: 12,
                  sm: 6,
                  md: 3,
                }}
              >
                <TextField
                  fullWidth
                  type="date"
                  label="From"
                  value={dateFrom}
                  onChange={(e) =>
                    setDateFrom(e.target.value)
                  }
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>

              <Grid
                size={{
                  xs: 12,
                  sm: 6,
                  md: 3,
                }}
              >
                <TextField
                  fullWidth
                  type="date"
                  label="To"
                  value={dateTo}
                  onChange={(e) =>
                    setDateTo(e.target.value)
                  }
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>

              <Grid
                size={{
                  xs: 12,
                  md: 2,
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={clearFilters}
                >
                  Clear
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* TABS */}
        <Card>
          <Tabs
            value={tab}
            onChange={(_, value) =>
              setTab(value)
            }
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label="Transactions" />
            <Tab label="Repayments" />
            <Tab label="Interest" />
            <Tab label="Loan Portfolio" />
          </Tabs>

          <Divider />

          <CardContent>
            {tab === 0 && (
              <TransactionTable
                transactions={
                  filteredTransactions
                }
              />
            )}

            {tab === 1 && (
              <TransactionTable
                transactions={
                  repaymentTransactions
                }
              />
            )}

            {tab === 2 && (
              <TransactionTable
                transactions={
                  interestTransactions
                }
              />
            )}

            {tab === 3 && (
              <PortfolioTable
                loans={summary.loans || []}
              />
            )}
          </CardContent>
        </Card>
      </Box>

      {/* =========================================================
          PRINT-ONLY REPORT
      ========================================================== */}

      <Box
        id="umhlomunye-print-report"
        className="reports-print"
      >
        <PrintReport
          title={reportTitle}
          summary={summary}
          tab={tab}
          transactions={
            tab === 0
              ? filteredTransactions
              : tab === 1
              ? repaymentTransactions
              : interestTransactions
          }
          loans={summary.loans || []}
          reportInterest={reportInterest}
          reportRepayments={reportRepayments}
          search={search}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      </Box>

      {/* =========================================================
          PRINT CSS
      ========================================================== */}

      <style>
        {`
          .reports-print {
            display: none;
          }

          @media print {
            @page {
              size: A4 portrait;
              margin: 12mm;
            }

            html,
            body {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
            }

            body * {
              visibility: hidden !important;
            }

            #umhlomunye-print-report,
            #umhlomunye-print-report * {
              visibility: visible !important;
            }

            #umhlomunye-print-report {
              display: block !important;
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              background: white !important;
            }

            .reports-screen {
              display: none !important;
            }

            .print-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 9pt;
            }

            .print-table th {
              background: #eeeeee !important;
              font-weight: 700;
              border: 1px solid #999;
              padding: 6px;
              text-align: left;
            }

            .print-table td {
              border: 1px solid #cccccc;
              padding: 6px;
              vertical-align: top;
            }

            .print-number {
              text-align: right !important;
              white-space: nowrap;
            }

            .print-summary-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 8px;
              margin: 15px 0;
            }

            .print-summary-box {
              border: 1px solid #999;
              padding: 9px;
              min-height: 55px;
            }

            .print-summary-label {
              font-size: 8pt;
              color: #555;
              margin-bottom: 4px;
            }

            .print-summary-value {
              font-size: 12pt;
              font-weight: 700;
            }

            .print-filter-box {
              border: 1px solid #bbb;
              padding: 8px;
              margin-bottom: 15px;
              font-size: 9pt;
            }

            .print-section {
              margin-top: 18px;
            }

            .print-section-title {
              font-size: 13pt;
              font-weight: 700;
              margin-bottom: 8px;
              border-bottom: 2px solid #222;
              padding-bottom: 4px;
            }

            .print-footer {
              margin-top: 20px;
              padding-top: 8px;
              border-top: 1px solid #aaa;
              font-size: 8pt;
              color: #555;
            }

            .print-table tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .print-section {
              break-inside: auto;
            }

            .print-page-break {
              page-break-before: always;
            }
          }
        `}
      </style>
    </>
  );
}

/* =============================================================
   PRINT REPORT COMPONENT
============================================================= */

function PrintReport({
  title,
  summary,
  tab,
  transactions,
  loans,
  reportInterest,
  reportRepayments,
  search,
  dateFrom,
  dateTo,
}) {
  const generatedAt = new Date();

  return (
    <div>
      {/* HEADER */}

      <div
        style={{
          borderBottom: "3px solid #111",
          paddingBottom: "10px",
        }}
      >
        <div
          style={{
            fontSize: "22pt",
            fontWeight: 800,
          }}
        >
          UMHLOMUNYE FINANCE
        </div>

        <div
          style={{
            fontSize: "16pt",
            fontWeight: 700,
            marginTop: "4px",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: "9pt",
            color: "#555",
            marginTop: "6px",
          }}
        >
          Official Financial Report
        </div>
      </div>

      {/* REPORT INFORMATION */}

      <div className="print-filter-box">
        <strong>Report Information</strong>

        <div style={{ marginTop: "5px" }}>
          Generated:
          {" "}
          {generatedAt.toLocaleString(
            "en-ZA"
          )}
        </div>

        <div>
          Reporting period:
          {" "}
          {dateFrom
            ? formatDate(dateFrom)
            : "All dates"}
          {" "}
          —{" "}
          {dateTo
            ? formatDate(dateTo)
            : "Current"}
        </div>

        {search && (
          <div>
            Search filter:{" "}
            <strong>{search}</strong>
          </div>
        )}
      </div>

      {/* SUMMARY */}

      <div className="print-summary-grid">
        <PrintSummaryBox
          label="Total Loans"
          value={summary.totalLoans}
        />

        <PrintSummaryBox
          label="Active Loans"
          value={summary.activeLoanCount}
        />

        <PrintSummaryBox
          label="Total Principal"
          value={money(
            summary.totalPrincipal
          )}
        />

        <PrintSummaryBox
          label="Outstanding Balance"
          value={money(
            summary.totalBalance
          )}
        />

        <PrintSummaryBox
          label="Total Paid"
          value={money(summary.totalPaid)}
        />

        <PrintSummaryBox
          label="Loan Interest"
          value={money(
            summary.totalInterest
          )}
        />

        <PrintSummaryBox
          label="Report Repayments"
          value={money(
            reportRepayments
          )}
        />

        <PrintSummaryBox
          label="Report Interest"
          value={money(reportInterest)}
        />
      </div>

      {/* TRANSACTION REPORT */}

      {tab !== 3 && (
        <div className="print-section">
          <div className="print-section-title">
            {title}
          </div>

          {transactions.length === 0 ? (
            <div>
              No transactions found for the
              selected filters.
            </div>
          ) : (
            <table className="print-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Loan</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="print-number">
                    Debit
                  </th>
                  <th className="print-number">
                    Credit
                  </th>
                  <th className="print-number">
                    Balance
                  </th>
                </tr>
              </thead>

              <tbody>
                {transactions.map(
                  (transaction) => (
                    <tr
                      key={transaction.id}
                    >
                      <td>
                        {formatDate(
                          transaction.transaction_date
                        )}
                      </td>

                      <td>
                        {transaction?.loans
                          ?.loan_number || "-"}
                      </td>

                      <td>
                        {getCustomerName(
                          transaction
                        )}
                      </td>

                      <td>
                        {transaction.transaction_type ||
                          "-"}
                      </td>

                      <td>
                        {transaction.description ||
                          "-"}
                      </td>

                      <td className="print-number">
                        {money(
                          transaction.debit
                        )}
                      </td>

                      <td className="print-number">
                        {money(
                          transaction.credit
                        )}
                      </td>

                      <td className="print-number">
                        <strong>
                          {money(
                            transaction.balance
                          )}
                        </strong>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PORTFOLIO REPORT */}

      {tab === 3 && (
        <div className="print-section">
          <div className="print-section-title">
            Loan Portfolio
          </div>

          {loans.length === 0 ? (
            <div>
              No loans found.
            </div>
          ) : (
            <table className="print-table">
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Customer</th>
                  <th className="print-number">
                    Principal
                  </th>
                  <th className="print-number">
                    Interest
                  </th>
                  <th className="print-number">
                    Total Repayment
                  </th>
                  <th className="print-number">
                    Paid
                  </th>
                  <th className="print-number">
                    Balance
                  </th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <td>
                      {loan.loan_number || "-"}
                    </td>

                    <td>
                      {getPortfolioCustomerName(
                        loan
                      )}
                    </td>

                    <td className="print-number">
                      {money(
                        loan.principal_amount
                      )}
                    </td>

                    <td className="print-number">
                      {money(
                        loan.interest_amount
                      )}
                    </td>

                    <td className="print-number">
                      {money(
                        loan.total_repayment
                      )}
                    </td>

                    <td className="print-number">
                      {money(loan.total_paid)}
                    </td>

                    <td className="print-number">
                      <strong>
                        {money(
                          loan.current_balance
                        )}
                      </strong>
                    </td>

                    <td>
                      {loan.loan_status || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* FOOTER */}

      <div className="print-footer">
        <div>
          Umhlomunye Finance — Confidential
          Financial Report
        </div>

        <div style={{ marginTop: "3px" }}>
          Generated electronically by the
          Umhlomunye Finance loan management
          system.
        </div>
      </div>
    </div>
  );
}

function PrintSummaryBox({
  label,
  value,
}) {
  return (
    <div className="print-summary-box">
      <div className="print-summary-label">
        {label}
      </div>

      <div className="print-summary-value">
        {value}
      </div>
    </div>
  );
}

/* =============================================================
   SCREEN TRANSACTION TABLE
============================================================= */

function TransactionTable({
  transactions,
}) {
  if (!transactions.length) {
    return (
      <Alert severity="info">
        No transactions found for the
        selected filters.
      </Alert>
    );
  }

  return (
    <Box sx={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            {[
              "Date",
              "Loan",
              "Customer",
              "Type",
              "Description",
              "Debit",
              "Credit",
              "Balance",
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  textAlign: "left",
                  padding: "12px",
                  borderBottom:
                    "1px solid #ddd",
                  whiteSpace: "nowrap",
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {transactions.map(
            (transaction) => (
              <tr key={transaction.id}>
                <td style={{ padding: "12px" }}>
                  {formatDate(
                    transaction.transaction_date
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  {transaction?.loans
                    ?.loan_number || "-"}
                </td>

                <td style={{ padding: "12px" }}>
                  {getCustomerName(
                    transaction
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  <Chip
                    size="small"
                    label={
                      transaction.transaction_type ||
                      "-"
                    }
                  />
                </td>

                <td style={{ padding: "12px" }}>
                  {transaction.description ||
                    "-"}
                </td>

                <td style={{ padding: "12px" }}>
                  {money(
                    transaction.debit
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  {money(
                    transaction.credit
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  <strong>
                    {money(
                      transaction.balance
                    )}
                  </strong>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </Box>
  );
}

/* =============================================================
   SCREEN PORTFOLIO TABLE
============================================================= */

function PortfolioTable({ loans }) {
  if (!loans.length) {
    return (
      <Alert severity="info">
        No loans found.
      </Alert>
    );
  }

  return (
    <Box sx={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            {[
              "Loan",
              "Customer",
              "Principal",
              "Interest",
              "Total Repayment",
              "Paid",
              "Balance",
              "Status",
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  textAlign: "left",
                  padding: "12px",
                  borderBottom:
                    "1px solid #ddd",
                  whiteSpace: "nowrap",
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loans.map((loan) => {
            const customer =
              loan.customers;

            return (
              <tr key={loan.id}>
                <td style={{ padding: "12px" }}>
                  {loan.loan_number}
                </td>

                <td style={{ padding: "12px" }}>
                  {customer
                    ? `${customer.first_name || ""} ${
                        customer.last_name || ""
                      }`.trim()
                    : "-"}
                </td>

                <td style={{ padding: "12px" }}>
                  {money(
                    loan.principal_amount
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  {money(
                    loan.interest_amount
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  {money(
                    loan.total_repayment
                  )}
                </td>

                <td style={{ padding: "12px" }}>
                  {money(loan.total_paid)}
                </td>

                <td style={{ padding: "12px" }}>
                  <strong>
                    {money(
                      loan.current_balance
                    )}
                  </strong>
                </td>

                <td style={{ padding: "12px" }}>
                  <Chip
                    size="small"
                    label={
                      loan.loan_status || "-"
                    }
                    color={
                      String(
                        loan.loan_status
                      ).toLowerCase() ===
                      "active"
                        ? "success"
                        : "default"
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
}