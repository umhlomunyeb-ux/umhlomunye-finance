import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EmailIcon from "@mui/icons-material/Email";

import { supabase } from "../../lib/supabase";

import {
  getLoanSummary,
  getRecentLoanTransactions,
} from "../../services/loanService";

import { getSystemSettings } from "../../services/settingsService";

import QRCode from "qrcode";

/* =============================================================
   HELPERS
============================================================= */

function money(value) {
  return `R${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "—";

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

function getTransactionDate(transaction) {
  return transaction?.transaction_date || transaction?.created_at || null;
}

function getCustomerName(transaction) {
  const customer = transaction?.loans?.customers;

  if (!customer) {
    return "Unknown Customer";
  }

  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ");

  return name || customer.customer_number || "Unknown Customer";
}

function getPortfolioCustomerName(loan) {
  const customer = loan?.customers;

  if (!customer) {
    return "Unknown Customer";
  }

  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ");

  return name || customer.customer_number || "Unknown Customer";
}

function getLoanDate(loan) {
  return (
    loan?.created_at ||
    loan?.loan_date ||
    loan?.disbursement_date ||
    loan?.start_date ||
    null
  );
}

function periodKey(date, period) {
  if (!date) return null;

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();

  if (period === "yearly") {
    return String(year);
  }

  const month = String(parsed.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function periodLabel(key, period) {
  if (!key) return "Unknown";

  if (period === "yearly") {
    return key;
  }

  const [year, month] = key.split("-");

  const date = new Date(
    Number(year),
    Number(month) - 1,
    1
  );

  return date.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
  });
}

function periodSort(a, b) {
  return a.key.localeCompare(b.key);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =============================================================
   FINANCIAL REPORT CALCULATION
============================================================= */

function buildFinancialReport(loans, transactions, period) {
  const periods = {};

  const ensurePeriod = (key) => {
    if (!key) return null;

    if (!periods[key]) {
      periods[key] = {
        key,
        label: periodLabel(key, period),
        principalGiven: 0,
        principalCollected: 0,
        interestCollected: 0,
      };
    }

    return periods[key];
  };

  const loanState = {};

  (loans || []).forEach((loan) => {
    if (!loan?.id) return;

    loanState[loan.id] = {
      principalRemaining: Number(
        loan.principal_amount || 0
      ),
      interestOutstanding: 0,
    };

    const loanDate = getLoanDate(loan);
    const key = periodKey(loanDate, period);
    const reportPeriod = ensurePeriod(key);

    if (reportPeriod) {
      reportPeriod.principalGiven += Number(
        loan.principal_amount || 0
      );
    }
  });

  const sortedTransactions = [...(transactions || [])].sort(
    (a, b) => {
      const dateA = new Date(
        getTransactionDate(a) || 0
      );

      const dateB = new Date(
        getTransactionDate(b) || 0
      );

      return dateA - dateB;
    }
  );

  sortedTransactions.forEach((transaction) => {
    const loanId = transaction?.loan_id;

    if (!loanId) return;

    if (!loanState[loanId]) {
      loanState[loanId] = {
        principalRemaining: 0,
        interestOutstanding: 0,
      };
    }

    const state = loanState[loanId];

    const transactionDate =
      getTransactionDate(transaction);

    const key = periodKey(
      transactionDate,
      period
    );

    const reportPeriod = ensurePeriod(key);

    if (!reportPeriod) return;

    const type = String(
      transaction?.transaction_type || ""
    ).toLowerCase();

    const debit = Number(
      transaction?.debit || 0
    );

    const credit = Number(
      transaction?.credit || 0
    );

    if (type === "interest") {
      const interestAmount =
        debit > 0
          ? debit
          : credit > 0
          ? credit
          : 0;

      state.interestOutstanding +=
        interestAmount;

      return;
    }

    if (type === "payment") {
      const paymentAmount =
        credit > 0
          ? credit
          : debit > 0
          ? debit
          : 0;

      if (paymentAmount <= 0) return;

      const interestCollected = Math.min(
        paymentAmount,
        state.interestOutstanding
      );

      reportPeriod.interestCollected +=
        interestCollected;

      state.interestOutstanding -=
        interestCollected;

      const remainingPayment =
        paymentAmount -
        interestCollected;

      const principalCollected =
        Math.min(
          remainingPayment,
          Math.max(
            state.principalRemaining,
            0
          )
        );

      reportPeriod.principalCollected +=
        principalCollected;

      state.principalRemaining -=
        principalCollected;
    }
  });

  return Object.values(periods).sort(periodSort);
}

/* =============================================================
   STAT CARD
============================================================= */

function StatCard({
  title,
  value,
  subtitle,
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderRadius: 2,
      }}
    >
      <CardContent>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1 }}
        >
          {title}
        </Typography>

        <Typography
          variant="h5"
          fontWeight={800}
        >
          {value}
        </Typography>

        {subtitle && (
          <Typography
            variant="caption"
            color="text.secondary"
          >
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/* =============================================================
   FINANCIAL LINE GRAPH
============================================================= */

function FinancialLineChart({
  data,
  period,
}) {
  if (!data?.length) {
    return (
      <Box
        sx={{
          height: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography color="text.secondary">
          No financial data available.
        </Typography>
      </Box>
    );
  }

  const width = 1000;
  const height = 360;

  const paddingLeft = 80;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 70;

  const chartWidth =
    width -
    paddingLeft -
    paddingRight;

  const chartHeight =
    height -
    paddingTop -
    paddingBottom;

  const values = data.flatMap((item) => [
    Number(item.principalGiven || 0),
    Number(item.principalCollected || 0),
    Number(item.interestCollected || 0),
  ]);

  const maxValue = Math.max(...values, 1);

  const getX = (index) => {
    if (data.length === 1) {
      return paddingLeft + chartWidth / 2;
    }

    return (
      paddingLeft +
      (index / (data.length - 1)) *
        chartWidth
    );
  };

  const getY = (value) => {
    return (
      paddingTop +
      chartHeight -
      (Number(value || 0) / maxValue) *
        chartHeight
    );
  };

  const createPoints = (field) =>
    data
      .map(
        (item, index) =>
          `${getX(index)},${getY(
            item[field]
          )}`
      )
      .join(" ");

  const principalGivenPoints =
    createPoints("principalGiven");

  const principalCollectedPoints =
    createPoints("principalCollected");

  const interestCollectedPoints =
    createPoints("interestCollected");

  const gridLines = 5;

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{
          width: "100%",
          overflowX: "auto",
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="360"
          role="img"
          aria-label={`Live ${
            period === "monthly"
              ? "monthly"
              : "yearly"
          } financial performance graph`}
        >
          {Array.from({
            length: gridLines + 1,
          }).map((_, index) => {
            const y =
              paddingTop +
              (index / gridLines) *
                chartHeight;

            const value =
              maxValue -
              (index / gridLines) *
                maxValue;

            return (
              <g key={index}>
                <line
                  x1={paddingLeft}
                  x2={width - paddingRight}
                  y1={y}
                  y2={y}
                  stroke="#e0e0e0"
                  strokeWidth="1"
                />

                <text
                  x={paddingLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="#666"
                >
                  {money(value)}
                </text>
              </g>
            );
          })}

          <line
            x1={paddingLeft}
            x2={width - paddingRight}
            y1={paddingTop + chartHeight}
            y2={paddingTop + chartHeight}
            stroke="#999"
            strokeWidth="1"
          />

          <polyline
            points={principalGivenPoints}
            fill="none"
            stroke="#1565c0"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          <polyline
            points={principalCollectedPoints}
            fill="none"
            stroke="#2e7d32"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          <polyline
            points={interestCollectedPoints}
            fill="none"
            stroke="#ed6c02"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {data.map((item, index) => (
            <g key={item.key}>
              <circle
                cx={getX(index)}
                cy={getY(item.principalGiven)}
                r="4"
                fill="#1565c0"
              />

              <circle
                cx={getX(index)}
                cy={getY(item.principalCollected)}
                r="4"
                fill="#2e7d32"
              />

              <circle
                cx={getX(index)}
                cy={getY(item.interestCollected)}
                r="4"
                fill="#ed6c02"
              />

              <text
                x={getX(index)}
                y={
                  paddingTop +
                  chartHeight +
                  25
                }
                textAnchor="middle"
                fontSize="10"
                fill="#555"
              >
                {item.label}
              </text>
            </g>
          ))}
        </svg>
      </Box>

      <Stack
        direction="row"
        spacing={3}
        justifyContent="center"
        flexWrap="wrap"
        sx={{ mt: 1 }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: "#1565c0",
            }}
          />

          <Typography variant="caption">
            Principal Given Out
          </Typography>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: "#2e7d32",
            }}
          />

          <Typography variant="caption">
            Principal Collected
          </Typography>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: "#ed6c02",
            }}
          />

          <Typography variant="caption">
            Interest Collected
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

/* =============================================================
   PRINT IMAGE WAIT
============================================================= */

function waitForPrintImages(printWindow) {
  const images = Array.from(
    printWindow.document.images || []
  );

  return Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    })
  );
}

/* =============================================================
   PRINT HEADER
============================================================= */

function buildPrintHeader(
  companySettings,
  qrCodeDataUrl
) {
  const companyName = escapeHtml(
    companySettings?.company_name ||
      "Umhlomunye Finance"
  );

  const companyAddress = escapeHtml(
    companySettings?.company_address || ""
  ).replace(/\n/g, "<br />");

  const logoUrl = escapeHtml(
    companySettings?.company_logo_url || ""
  );

  return `
    <div class="report-header">
      <div class="company-section">
        ${
          logoUrl
            ? `
              <img
                class="company-logo"
                src="${logoUrl}"
                alt="${companyName}"
              />
            `
            : ""
        }

        <div class="company-name">
          ${companyName}
        </div>

        ${
          companyAddress
            ? `
              <div class="company-address">
                ${companyAddress}
              </div>
            `
            : ""
        }
      </div>

      <div class="qr-section">
        ${
          qrCodeDataUrl
            ? `
              <img
                class="qr-code"
                src="${qrCodeDataUrl}"
                alt="Report QR Code"
              />
            `
            : ""
        }
      </div>
    </div>
  `;
}

/* =============================================================
   PRINT FINANCIAL REPORT
============================================================= */

async function printFinancialReport(
  reportData,
  period,
  totals,
  companySettings
) {
  if (!reportData.length) {
    alert(
      "There is no financial report data to print."
    );
    return;
  }

  const generatedAt =
    new Date().toLocaleString("en-ZA");

  const periodTitle =
    period === "monthly"
      ? "Monthly Financial Report"
      : "Yearly Financial Report";

  const periodColumn =
    period === "monthly"
      ? "Month"
      : "Year";

  let qrCodeDataUrl = "";

  try {
    qrCodeDataUrl =
      await QRCode.toDataURL(
        JSON.stringify({
          company:
            companySettings?.company_name ||
            "Umhlomunye Finance",
          report: periodTitle,
          generatedAt,
          type: "Financial Report",
        }),
        {
          width: 180,
          margin: 1,
        }
      );
  } catch (qrError) {
    console.error(
      "Unable to generate report QR code:",
      qrError
    );
  }

  const rows = reportData
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.label)}</td>

          <td class="number">
            ${money(item.principalGiven)}
          </td>

          <td class="number">
            ${money(item.principalCollected)}
          </td>

          <td class="number">
            ${money(item.interestCollected)}
          </td>
        </tr>
      `
    )
    .join("");

  const printWindow = window.open(
    "",
    "_blank",
    "width=1200,height=900"
  );

  if (!printWindow) {
    alert(
      "Please allow pop-ups in your browser to print the report."
    );
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>

    <html>
      <head>
        <title>
          ${escapeHtml(
            companySettings?.company_name ||
              "Umhlomunye Finance"
          )}
          - ${periodTitle}
        </title>

        <meta charset="UTF-8" />

        <style>
          @page {
            size: A4 portrait;
            margin: 14mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #111;
            background: white;
          }

          .report-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            width: 100%;
            min-height: 95px;
            padding-bottom: 12px;
            margin-bottom: 18px;
            border-bottom: 3px solid #111;
          }

          .company-section {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            min-width: 0;
          }

          .company-logo {
            max-width: 150px;
            max-height: 55px;
            object-fit: contain;
            margin-bottom: 7px;
          }

          .company-name {
            font-size: 20px;
            font-weight: 800;
          }

          .company-address {
            font-size: 10px;
            color: #555;
            margin-top: 4px;
            max-width: 480px;
            line-height: 1.4;
          }

          .qr-section {
            width: 90px;
            height: 90px;
            display: flex;
            align-items: flex-start;
            justify-content: flex-end;
            flex-shrink: 0;
          }

          .qr-code {
            width: 80px;
            height: 80px;
            object-fit: contain;
          }

          .report-title {
            font-size: 18px;
            font-weight: 700;
            margin-top: 5px;
          }

          .subtitle {
            font-size: 11px;
            color: #555;
            margin-top: 6px;
          }

          .info-box {
            border: 1px solid #bbb;
            padding: 10px;
            margin-bottom: 18px;
            font-size: 11px;
          }

          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 22px;
          }

          .summary-box {
            border: 1px solid #999;
            padding: 12px;
            min-height: 70px;
          }

          .summary-label {
            font-size: 10px;
            color: #555;
            margin-bottom: 6px;
          }

          .summary-value {
            font-size: 16px;
            font-weight: 700;
          }

          .section-title {
            font-size: 14px;
            font-weight: 700;
            border-bottom: 2px solid #222;
            padding-bottom: 5px;
            margin-bottom: 10px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }

          th {
            background: #eeeeee;
            font-weight: 700;
            border: 1px solid #999;
            padding: 8px;
            text-align: left;
          }

          td {
            border: 1px solid #ccc;
            padding: 8px;
          }

          .number {
            text-align: right;
            white-space: nowrap;
          }

          tfoot td {
            border-top: 2px solid #777;
            font-weight: 700;
          }

          .footer {
            margin-top: 25px;
            padding-top: 9px;
            border-top: 1px solid #aaa;
            font-size: 9px;
            color: #555;
          }

          .confidential {
            font-weight: 700;
            margin-bottom: 4px;
          }

          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            table {
              page-break-inside: auto;
            }

            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
          }
        </style>
      </head>

      <body>

        ${buildPrintHeader(
          companySettings,
          qrCodeDataUrl
        )}

        <div class="report-title">
          ${periodTitle}
        </div>

        <div class="subtitle">
          Official Financial Report
        </div>

        <div class="info-box">
          <strong>Report Information</strong>

          <div style="margin-top: 5px;">
            Report type: ${periodTitle}
          </div>

          <div>
            Generated: ${escapeHtml(
              generatedAt
            )}
          </div>
        </div>

        <div class="summary-grid">

          <div class="summary-box">
            <div class="summary-label">
              Principal Given Out
            </div>

            <div class="summary-value">
              ${money(
                totals.principalGiven
              )}
            </div>
          </div>

          <div class="summary-box">
            <div class="summary-label">
              Principal Collected
            </div>

            <div class="summary-value">
              ${money(
                totals.principalCollected
              )}
            </div>
          </div>

          <div class="summary-box">
            <div class="summary-label">
              Interest Collected
            </div>

            <div class="summary-value">
              ${money(
                totals.interestCollected
              )}
            </div>
          </div>

        </div>

        <div class="section-title">
          ${periodTitle}
        </div>

        <table>

          <thead>
            <tr>
              <th>
                ${periodColumn}
              </th>

              <th class="number">
                Principal Given Out
              </th>

              <th class="number">
                Principal Collected
              </th>

              <th class="number">
                Interest Collected
              </th>
            </tr>
          </thead>

          <tbody>
            ${rows}
          </tbody>

          <tfoot>
            <tr>
              <td>TOTAL</td>

              <td class="number">
                ${money(
                  totals.principalGiven
                )}
              </td>

              <td class="number">
                ${money(
                  totals.principalCollected
                )}
              </td>

              <td class="number">
                ${money(
                  totals.interestCollected
                )}
              </td>
            </tr>
          </tfoot>

        </table>

        <div class="footer">

          <div class="confidential">
            ${escapeHtml(
              companySettings?.company_name ||
                "Umhlomunye Finance"
            )}
            — Confidential Financial Report
          </div>

          <div>
            Generated electronically by the
            loan management system.
          </div>

        </div>

      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  setTimeout(async () => {
    await waitForPrintImages(
      printWindow
    );

    printWindow.print();
  }, 300);
}

/* =============================================================
   FINANCIAL REPORT VIEW
============================================================= */

function FinancialReportView({
  reportData,
  period,
  totals,
}) {
  const periodTitle =
    period === "monthly"
      ? "Monthly Financial Report"
      : "Yearly Financial Report";

  const periodColumn =
    period === "monthly"
      ? "Month"
      : "Year";

  return (
    <Box>

      <Grid
        container
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Grid
          size={{
            xs: 12,
            md: 4,
          }}
        >
          <StatCard
            title="Principal Given Out"
            value={money(
              totals.principalGiven
            )}
          />
        </Grid>

        <Grid
          size={{
            xs: 12,
            md: 4,
          }}
        >
          <StatCard
            title="Principal Collected"
            value={money(
              totals.principalCollected
            )}
          />
        </Grid>

        <Grid
          size={{
            xs: 12,
            md: 4,
          }}
        >
          <StatCard
            title="Interest Collected"
            value={money(
              totals.interestCollected
            )}
          />
        </Grid>
      </Grid>

      {reportData.length === 0 ? (
        <Alert severity="info">
          No financial report data is
          available yet.
        </Alert>
      ) : (
        <Box sx={{ overflowX: "auto" }}>

          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ mb: 2 }}
          >
            {periodTitle}
          </Typography>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr>

                <th
                  style={{
                    textAlign: "left",
                    padding: "12px",
                    borderBottom:
                      "1px solid #ddd",
                  }}
                >
                  {periodColumn}
                </th>

                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    borderBottom:
                      "1px solid #ddd",
                  }}
                >
                  Principal Given Out
                </th>

                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    borderBottom:
                      "1px solid #ddd",
                  }}
                >
                  Principal Collected
                </th>

                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    borderBottom:
                      "1px solid #ddd",
                  }}
                >
                  Interest Collected
                </th>

              </tr>
            </thead>

            <tbody>

              {reportData.map((item) => (
                <tr key={item.key}>

                  <td
                    style={{
                      padding: "12px",
                      fontWeight: 600,
                      borderBottom:
                        "1px solid #eee",
                    }}
                  >
                    {item.label}
                  </td>

                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      borderBottom:
                        "1px solid #eee",
                    }}
                  >
                    {money(
                      item.principalGiven
                    )}
                  </td>

                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      borderBottom:
                        "1px solid #eee",
                    }}
                  >
                    {money(
                      item.principalCollected
                    )}
                  </td>

                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      borderBottom:
                        "1px solid #eee",
                    }}
                  >
                    {money(
                      item.interestCollected
                    )}
                  </td>

                </tr>
              ))}

            </tbody>

            <tfoot>

              <tr>

                <td
                  style={{
                    padding: "12px",
                    fontWeight: 700,
                    borderTop:
                      "2px solid #999",
                  }}
                >
                  Total
                </td>

                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    fontWeight: 700,
                    borderTop:
                      "2px solid #999",
                  }}
                >
                  {money(
                    totals.principalGiven
                  )}
                </td>

                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    fontWeight: 700,
                    borderTop:
                      "2px solid #999",
                  }}
                >
                  {money(
                    totals.principalCollected
                  )}
                </td>

                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    fontWeight: 700,
                    borderTop:
                      "2px solid #999",
                  }}
                >
                  {money(
                    totals.interestCollected
                  )}
                </td>

              </tr>

            </tfoot>
          </table>

        </Box>
      )}

    </Box>
  );
}

/* =============================================================
   FINANCIAL REPORT ACTION CARD
============================================================= */

function FinancialReportCard({
  title,
  description,
  reportData,
  totals,
  period,
  companySettings,
  onView,
}) {
  const hasData = reportData.length > 0;

  const handlePrint = async () => {
    await printFinancialReport(
      reportData,
      period,
      totals,
      companySettings
    );
  };

  const handleEmail = () => {
    if (!hasData) {
      alert(
        "There is no financial report data to email."
      );
      return;
    }

    const subject =
      `${companySettings?.company_name || "Umhlomunye Finance"} - ` +
      `${title}`;

    const body =
      `${title}\n\n` +
      `Principal Given Out: ${money(
        totals.principalGiven
      )}\n` +
      `Principal Collected: ${money(
        totals.principalCollected
      )}\n` +
      `Interest Collected: ${money(
        totals.interestCollected
      )}\n\n` +
      `Generated: ${new Date().toLocaleString(
        "en-ZA"
      )}\n\n` +
      `This report was generated by the ` +
      `${companySettings?.company_name || "Umhlomunye Finance"} ` +
      `loan management system.`;

    window.location.href =
      `mailto:?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Card
      elevation={2}
      sx={{
        height: "100%",
        borderRadius: 3,
      }}
    >
      <CardContent
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >

        <Box sx={{ mb: 2 }}>
          <Typography
            variant="h6"
            fontWeight={800}
          >
            {title}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {description}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Grid
          container
          spacing={1}
          sx={{ mb: 2 }}
        >

          <Grid
            size={{
              xs: 12,
              sm: 4,
            }}
          >
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Principal Given
              </Typography>

              <Typography
                variant="body1"
                fontWeight={700}
              >
                {money(
                  totals.principalGiven
                )}
              </Typography>
            </Box>
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 4,
            }}
          >
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Principal Collected
              </Typography>

              <Typography
                variant="body1"
                fontWeight={700}
              >
                {money(
                  totals.principalCollected
                )}
              </Typography>
            </Box>
          </Grid>

          <Grid
            size={{
              xs: 12,
              sm: 4,
            }}
          >
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Interest Collected
              </Typography>

              <Typography
                variant="body1"
                fontWeight={700}
              >
                {money(
                  totals.interestCollected
                )}
              </Typography>
            </Box>
          </Grid>

        </Grid>

        <Box
          sx={{
            mt: "auto",
            display: "flex",
            gap: 1,
            flexWrap: "wrap",
          }}
        >

          <Button
            variant="contained"
            startIcon={
              <VisibilityIcon />
            }
            onClick={onView}
            disabled={!hasData}
          >
            View
          </Button>

          <Button
            variant="outlined"
            startIcon={
              <PrintIcon />
            }
            onClick={handlePrint}
            disabled={!hasData}
          >
            Print
          </Button>

          <Button
            variant="outlined"
            startIcon={
              <EmailIcon />
            }
            onClick={handleEmail}
            disabled={!hasData}
          >
            Email
          </Button>

        </Box>

      </CardContent>
    </Card>
  );
}

/* =============================================================
   FINANCIAL PERFORMANCE
============================================================= */

function FinancialPerformance({
  loans,
  transactions,
  companySettings,
}) {
  const [viewReport, setViewReport] =
    useState(null);

  const monthlyData = useMemo(
    () =>
      buildFinancialReport(
        loans,
        transactions,
        "monthly"
      ),
    [loans, transactions]
  );

  const yearlyData = useMemo(
    () =>
      buildFinancialReport(
        loans,
        transactions,
        "yearly"
      ),
    [loans, transactions]
  );

  const calculateTotals = (data) =>
    data.reduce(
      (result, item) => ({
        principalGiven:
          result.principalGiven +
          Number(
            item.principalGiven || 0
          ),

        principalCollected:
          result.principalCollected +
          Number(
            item.principalCollected || 0
          ),

        interestCollected:
          result.interestCollected +
          Number(
            item.interestCollected || 0
          ),
      }),
      {
        principalGiven: 0,
        principalCollected: 0,
        interestCollected: 0,
      }
    );

  const monthlyTotals = useMemo(
    () => calculateTotals(monthlyData),
    [monthlyData]
  );

  const yearlyTotals = useMemo(
    () => calculateTotals(yearlyData),
    [yearlyData]
  );

  return (
    <Card
      elevation={2}
      sx={{
        mb: 3,
        borderRadius: 3,
      }}
    >
      <CardContent>

        <Box sx={{ mb: 3 }}>
          <Typography
            variant="h6"
            fontWeight={800}
          >
            Financial Reports
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            Select a monthly or yearly
            financial report to view, print
            or email it.
          </Typography>
        </Box>

        <Grid
          container
          spacing={2}
        >

          <Grid
            size={{
              xs: 12,
              md: 6,
            }}
          >
            <FinancialReportCard
              title="Monthly Report"
              description="Financial performance grouped by month."
              reportData={monthlyData}
              totals={monthlyTotals}
              period="monthly"
              companySettings={
                companySettings
              }
              onView={() =>
                setViewReport({
                  period: "monthly",
                  data: monthlyData,
                  totals: monthlyTotals,
                  title:
                    "Monthly Financial Report",
                })
              }
            />
          </Grid>

          <Grid
            size={{
              xs: 12,
              md: 6,
            }}
          >
            <FinancialReportCard
              title="Yearly Report"
              description="Financial performance grouped by year."
              reportData={yearlyData}
              totals={yearlyTotals}
              period="yearly"
              companySettings={
                companySettings
              }
              onView={() =>
                setViewReport({
                  period: "yearly",
                  data: yearlyData,
                  totals: yearlyTotals,
                  title:
                    "Yearly Financial Report",
                })
              }
            />
          </Grid>

        </Grid>

        <Paper
          variant="outlined"
          sx={{
            p: {
              xs: 1,
              md: 2,
            },
            mt: 3,
            borderRadius: 2,
          }}
        >
          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            justifyContent="space-between"
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography
                variant="subtitle1"
                fontWeight={700}
              >
                Live Financial Trend
              </Typography>

              <Typography
                variant="caption"
                color="text.secondary"
              >
                Monthly financial performance
                over time
              </Typography>
            </Box>

            <Chip
              size="small"
              label="Live"
              color="primary"
              variant="outlined"
            />
          </Stack>

          <FinancialLineChart
            data={monthlyData}
            period="monthly"
          />
        </Paper>

        <Dialog
          open={Boolean(viewReport)}
          onClose={() =>
            setViewReport(null)
          }
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle>
            {viewReport?.title}
          </DialogTitle>

          <DialogContent dividers>
            {viewReport && (
              <FinancialReportView
                reportData={
                  viewReport.data
                }
                period={
                  viewReport.period
                }
                totals={
                  viewReport.totals
                }
              />
            )}
          </DialogContent>

          <DialogActions>

            <Button
              onClick={() =>
                setViewReport(null)
              }
            >
              Close
            </Button>

            {viewReport && (
              <Button
                variant="contained"
                startIcon={
                  <PrintIcon />
                }
                onClick={() =>
                  printFinancialReport(
                    viewReport.data,
                    viewReport.period,
                    viewReport.totals,
                    companySettings
                  )
                }
              >
                Print
              </Button>
            )}

          </DialogActions>
        </Dialog>

      </CardContent>
    </Card>
  );
}

/* =============================================================
   TRANSACTION TABLE
============================================================= */

function TransactionTable({
  transactions,
}) {
  if (!transactions.length) {
    return (
      <Alert severity="info">
        No transactions found.
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
              "Debit",
              "Credit",
              "Description",
            ].map((heading, index) => (
              <th
                key={heading}
                style={{
                  textAlign:
                    index === 4 ||
                    index === 5
                      ? "right"
                      : "left",
                  padding: "12px",
                  borderBottom:
                    "1px solid #ddd",
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

                <td
                  style={{
                    padding: "12px",
                    borderBottom:
                      "1px solid #eee",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatDate(
                    getTransactionDate(
                      transaction
                    )
                  )}
                </td>

                <td
                  style={{
                    padding: "12px",
                    borderBottom:
                      "1px solid #eee",
                  }}
                >
                  {transaction?.loans
                    ?.loan_number ||
                    transaction?.loan_number ||
                    "—"}
                </td>

                <td
                  style={{
                    padding: "12px",
                    borderBottom:
                      "1px solid #eee",
                  }}
                >
                  {getCustomerName(
                    transaction
                  )}
                </td>

                <td
                  style={{
                    padding: "12px",
                    borderBottom:
                      "1px solid #eee",
                  }}
                >
                  <Chip
                    size="small"
                    label={
                      transaction?.transaction_type ||
                      "—"
                    }
                  />
                </td>

                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    borderBottom:
                      "1px solid #eee",
                  }}
                >
                  {money(
                    transaction?.debit
                  )}
                </td>

                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    borderBottom:
                      "1px solid #eee",
                  }}
                >
                  {money(
                    transaction?.credit
                  )}
                </td>

                <td
                  style={{
                    padding: "12px",
                    borderBottom:
                      "1px solid #eee",
                  }}
                >
                  {transaction?.description ||
                    "—"}
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
   PORTFOLIO TABLE
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
              "Status",
              "Principal",
              "Balance",
              "Paid",
              "Interest",
            ].map((heading, index) => (
              <th
                key={heading}
                style={{
                  textAlign:
                    index >= 3
                      ? "right"
                      : "left",
                  padding: "12px",
                  borderBottom:
                    "1px solid #ddd",
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loans.map((loan) => (
            <tr key={loan.id}>

              <td
                style={{
                  padding: "12px",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                {loan.loan_number || "—"}
              </td>

              <td
                style={{
                  padding: "12px",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                {getPortfolioCustomerName(
                  loan
                )}
              </td>

              <td
                style={{
                  padding: "12px",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                <Chip
                  size="small"
                  label={
                    loan.loan_status || "—"
                  }
                />
              </td>

              <td
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                {money(
                  loan.principal_amount
                )}
              </td>

              <td
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                {money(
                  loan.current_balance
                )}
              </td>

              <td
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                {money(
                  loan.total_paid
                )}
              </td>

              <td
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom:
                    "1px solid #eee",
                }}
              >
                {money(
                  loan.interest_amount
                )}
              </td>

            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

/* =============================================================
   MAIN REPORTS PAGE
============================================================= */

export default function Reports() {
  const [summary, setSummary] =
    useState({
      loans: [],
      totalLoans: 0,
      activeLoans: 0,
      totalPrincipal: 0,
      outstandingBalance: 0,
      totalPaid: 0,
      totalInterest: 0,
    });

  const [transactions, setTransactions] =
    useState([]);

  const [companySettings, setCompanySettings] =
    useState({
      company_name:
        "Umhlomunye Finance",
      company_address: "",
      company_logo_url: "",
    });

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [tab, setTab] =
    useState(0);

  const [search, setSearch] =
    useState("");

  const [dateFrom, setDateFrom] =
    useState("");

  const [dateTo, setDateTo] =
    useState("");

  /* =========================================================
     LOAD REPORT DATA
  ========================================================= */

  const loadReports = useCallback(
    async () => {
      try {
        setError("");

        const [
          summaryResult,
          transactionsResult,
          systemSettings,
        ] = await Promise.all([
          getLoanSummary(),
          getRecentLoanTransactions(
            5000
          ),
          getSystemSettings(),
        ]);

        const rawLoans =
          Array.isArray(
            summaryResult?.loans
          )
            ? summaryResult.loans
            : [];

        const safeLoans =
          rawLoans.filter(
            (loan) =>
              loan &&
              typeof loan === "object"
          );

        const activeLoans =
          safeLoans.filter(
            (loan) =>
              String(
                loan?.loan_status || ""
              ).toLowerCase() ===
                "active" &&
              !loan?.is_deleted
          );

        const totalPrincipal =
          safeLoans.reduce(
            (sum, loan) =>
              sum +
              Number(
                loan?.principal_amount ||
                  0
              ),
            0
          );

        const outstandingBalance =
          activeLoans.reduce(
            (sum, loan) =>
              sum +
              Number(
                loan?.current_balance ||
                  0
              ),
            0
          );

        const totalPaid =
          safeLoans.reduce(
            (sum, loan) =>
              sum +
              Number(
                loan?.total_paid || 0
              ),
            0
          );

        const totalInterest =
          safeLoans.reduce(
            (sum, loan) =>
              sum +
              Number(
                loan?.interest_amount ||
                  0
              ),
            0
          );

        setSummary({
          loans: safeLoans,
          totalLoans:
            safeLoans.length,
          activeLoans:
            activeLoans.length,
          totalPrincipal,
          outstandingBalance,
          totalPaid,
          totalInterest,
        });

        setTransactions(
          Array.isArray(
            transactionsResult
          )
            ? transactionsResult
            : []
        );

        setCompanySettings({
          company_name:
            systemSettings?.company_name ||
            "Umhlomunye Finance",

          company_address:
            systemSettings?.company_address ||
            "",

          company_logo_url:
            systemSettings?.company_logo_url ||
            "",
        });
      } catch (err) {
        console.error(
          "REPORTS ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load reports."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  /* =========================================================
     REALTIME
  ========================================================= */

  useEffect(() => {
    let refreshTimer = null;

    const channel = supabase
      .channel("reports-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loans",
        },
        () => {
          if (refreshTimer) {
            clearTimeout(
              refreshTimer
            );
          }

          refreshTimer = setTimeout(
            () => {
              loadReports();
            },
            250
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_transactions",
        },
        () => {
          if (refreshTimer) {
            clearTimeout(
              refreshTimer
            );
          }

          refreshTimer = setTimeout(
            () => {
              loadReports();
            },
            250
          );
        }
      )
      .subscribe((status) => {
        if (
          status ===
          "CHANNEL_ERROR"
        ) {
          console.error(
            "Reports realtime channel error."
          );
        }

        if (
          status ===
          "TIMED_OUT"
        ) {
          console.error(
            "Reports realtime channel timed out."
          );
        }
      });

    return () => {
      if (refreshTimer) {
        clearTimeout(
          refreshTimer
        );
      }

      supabase.removeChannel(
        channel
      );
    };
  }, [loadReports]);

  /* =========================================================
     FILTER TRANSACTIONS
  ========================================================= */

  const filteredTransactions =
    useMemo(() => {
      const normalizedSearch =
        search
          .trim()
          .toLowerCase();

      return transactions.filter(
        (transaction) => {
          const customerName =
            getCustomerName(
              transaction
            );

          const loanNumber =
            transaction?.loans
              ?.loan_number ||
            transaction?.loan_number ||
            "";

          const description =
            transaction?.description ||
            "";

          const transactionType =
            transaction?.transaction_type ||
            "";

          const searchMatches =
            !normalizedSearch ||
            customerName
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            String(
              loanNumber
            )
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            String(
              description
            )
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            String(
              transactionType
            )
              .toLowerCase()
              .includes(
                normalizedSearch
              );

          if (!searchMatches) {
            return false;
          }

          const transactionDate =
            getTransactionDate(
              transaction
            );

          if (
            dateFrom &&
            transactionDate
          ) {
            const fromDate =
              new Date(
                `${dateFrom}T00:00:00`
              );

            if (
              new Date(
                transactionDate
              ) < fromDate
            ) {
              return false;
            }
          }

          if (
            dateTo &&
            transactionDate
          ) {
            const toDate =
              new Date(
                `${dateTo}T23:59:59`
              );

            if (
              new Date(
                transactionDate
              ) > toDate
            ) {
              return false;
            }
          }

          return true;
        }
      );
    }, [
      transactions,
      search,
      dateFrom,
      dateTo,
    ]);

  /* =========================================================
     REPORT TOTALS
  ========================================================= */

  const reportInterest = useMemo(
    () =>
      filteredTransactions
        .filter(
          (transaction) =>
            String(
              transaction?.transaction_type ||
                ""
            ).toLowerCase() ===
            "interest"
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction?.debit || 0
            ),
          0
        ),
    [filteredTransactions]
  );

  const reportRepayments =
    useMemo(
      () =>
        filteredTransactions
          .filter(
            (transaction) =>
              String(
                transaction?.transaction_type ||
                  ""
              ).toLowerCase() ===
              "payment"
          )
          .reduce(
            (sum, transaction) =>
              sum +
              Number(
                transaction?.credit ||
                  0
              ),
            0
          ),
      [filteredTransactions]
    );

  /* =========================================================
     TAB TITLE
  ========================================================= */

  const reportTitle = useMemo(() => {
    switch (tab) {
      case 1:
        return "Repayments Report";

      case 2:
        return "Interest Report";

      case 3:
        return "Loan Portfolio Report";

      default:
        return "Transaction Report";
    }
  }, [tab]);

  /* =========================================================
     CLEAR FILTERS
  ========================================================= */

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
  };

  /* =========================================================
     CSV EXPORT
  ========================================================= */

  const exportCSV = () => {
    const headers = [
      "Date",
      "Loan Number",
      "Customer",
      "Transaction Type",
      "Debit",
      "Credit",
      "Description",
    ];

    const rows =
      filteredTransactions.map(
        (transaction) => [
          formatDate(
            getTransactionDate(
              transaction
            )
          ),
          transaction?.loans
            ?.loan_number ||
            transaction?.loan_number ||
            "",
          getCustomerName(
            transaction
          ),
          transaction?.transaction_type ||
            "",
          Number(
            transaction?.debit || 0
          ).toFixed(2),
          Number(
            transaction?.credit || 0
          ).toFixed(2),
          transaction?.description ||
            "",
        ]
      );

    const csv = [
      headers,
      ...rows,
    ]
      .map((row) =>
        row
          .map((value) => {
            const text =
              String(value);

            return `"${text.replace(
              /"/g,
              '""'
            )}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;",
      }
    );

    const url =
      URL.createObjectURL(
        blob
      );

    const link =
      document.createElement(
        "a"
      );

    link.href = url;

    link.download =
      "umhlomunye-finance-report.csv";

    document.body.appendChild(
      link
    );

    link.click();

    document.body.removeChild(
      link
    );

    URL.revokeObjectURL(
      url
    );
  };

  /* =========================================================
     PRINT EXISTING REPORT
  ========================================================= */

  const printReport = async () => {
    const printWindow =
      window.open(
        "",
        "_blank",
        "width=1200,height=900"
      );

    if (!printWindow) {
      alert(
        "Please allow pop-ups in your browser to print the report."
      );
      return;
    }

    const generatedAt =
      new Date().toLocaleString(
        "en-ZA"
      );

    let qrCodeDataUrl = "";

    try {
      qrCodeDataUrl =
        await QRCode.toDataURL(
          JSON.stringify({
            company:
              companySettings?.company_name ||
              "Umhlomunye Finance",
            report:
              reportTitle,
            generatedAt,
            type: "Loan Report",
          }),
          {
            width: 180,
            margin: 1,
          }
        );
    } catch (qrError) {
      console.error(
        "Unable to generate report QR code:",
        qrError
      );
    }

    let content = "";

    if (tab === 3) {
      const rows =
        summary.loans
          .map(
            (loan) => `
              <tr>
                <td>${escapeHtml(
                  loan.loan_number ||
                    "—"
                )}</td>

                <td>${escapeHtml(
                  getPortfolioCustomerName(
                    loan
                  )
                )}</td>

                <td>${escapeHtml(
                  loan.loan_status ||
                    "—"
                )}</td>

                <td class="number">
                  ${money(
                    loan.principal_amount
                  )}
                </td>

                <td class="number">
                  ${money(
                    loan.current_balance
                  )}
                </td>

                <td class="number">
                  ${money(
                    loan.total_paid
                  )}
                </td>

                <td class="number">
                  ${money(
                    loan.interest_amount
                  )}
                </td>
              </tr>
            `
          )
          .join("");

      content = `
        <table>

          <thead>
            <tr>
              <th>Loan</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Principal</th>
              <th>Balance</th>
              <th>Paid</th>
              <th>Interest</th>
            </tr>
          </thead>

          <tbody>
            ${rows}
          </tbody>

        </table>
      `;
    } else {
      const reportTransactions =
        filteredTransactions.filter(
          (transaction) => {
            const type =
              String(
                transaction?.transaction_type ||
                  ""
              ).toLowerCase();

            if (tab === 1) {
              return (
                type === "payment"
              );
            }

            if (tab === 2) {
              return (
                type === "interest"
              );
            }

            return true;
          }
        );

      const rows =
        reportTransactions
          .map(
            (transaction) => `
              <tr>

                <td>
                  ${formatDate(
                    getTransactionDate(
                      transaction
                    )
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    transaction?.loans
                      ?.loan_number ||
                      transaction?.loan_number ||
                      "—"
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    getCustomerName(
                      transaction
                    )
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    transaction?.transaction_type ||
                      "—"
                  )}
                </td>

                <td class="number">
                  ${money(
                    transaction?.debit
                  )}
                </td>

                <td class="number">
                  ${money(
                    transaction?.credit
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    transaction?.description ||
                      "—"
                  )}
                </td>

              </tr>
            `
          )
          .join("");

      content = `
        <table>

          <thead>
            <tr>
              <th>Date</th>
              <th>Loan</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Description</th>
            </tr>
          </thead>

          <tbody>
            ${rows}
          </tbody>

        </table>
      `;
    }

    printWindow.document.write(`
      <!DOCTYPE html>

      <html>

        <head>

          <title>
            ${escapeHtml(
              companySettings?.company_name ||
                "Umhlomunye Finance"
            )}
            -
            ${escapeHtml(
              reportTitle
            )}
          </title>

          <meta charset="UTF-8" />

          <style>

            @page {
              size: A4 landscape;
              margin: 12mm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 0;
              font-family:
                Arial,
                Helvetica,
                sans-serif;
              color: #111;
              background: white;
            }

            .report-header {
              display: flex;
              justify-content:
                space-between;
              align-items:
                flex-start;
              width: 100%;
              min-height: 90px;
              padding-bottom: 12px;
              margin-bottom: 15px;
              border-bottom:
                3px solid #111;
            }

            .company-section {
              display: flex;
              flex-direction:
                column;
              align-items:
                flex-start;
              min-width: 0;
            }

            .company-logo {
              max-width: 150px;
              max-height: 55px;
              object-fit: contain;
              margin-bottom: 7px;
            }

            .company-name {
              font-size: 20px;
              font-weight: 800;
            }

            .company-address {
              font-size: 10px;
              color: #555;
              margin-top: 4px;
              max-width: 500px;
              line-height: 1.4;
            }

            .qr-section {
              width: 90px;
              height: 90px;
              display: flex;
              align-items:
                flex-start;
              justify-content:
                flex-end;
              flex-shrink: 0;
            }

            .qr-code {
              width: 80px;
              height: 80px;
              object-fit: contain;
            }

            h1 {
              margin: 0;
              font-size: 24px;
            }

            h2 {
              margin: 5px 0 15px;
              font-size: 18px;
            }

            .meta {
              font-size: 11px;
              color: #555;
              margin-bottom: 20px;
            }

            .summary {
              display: flex;
              gap: 12px;
              margin-bottom: 20px;
            }

            .summary-box {
              border: 1px solid #aaa;
              padding: 10px;
              flex: 1;
            }

            .label {
              font-size: 10px;
              color: #666;
            }

            .value {
              font-size: 15px;
              font-weight: 700;
              margin-top: 5px;
            }

            table {
              width: 100%;
              border-collapse:
                collapse;
              font-size: 10px;
            }

            th {
              background: #eee;
              border:
                1px solid #999;
              padding: 7px;
              text-align: left;
            }

            td {
              border:
                1px solid #ccc;
              padding: 7px;
            }

            .number {
              text-align: right;
            }

            .footer {
              margin-top: 20px;
              border-top:
                1px solid #aaa;
              padding-top: 8px;
              font-size: 9px;
              color: #666;
            }

            @media print {
              body {
                -webkit-print-color-adjust:
                  exact;
                print-color-adjust:
                  exact;
              }

              table {
                page-break-inside:
                  auto;
              }

              tr {
                page-break-inside:
                  avoid;
                page-break-after:
                  auto;
              }
            }

          </style>

        </head>

        <body>

          ${buildPrintHeader(
            companySettings,
            qrCodeDataUrl
          )}

          <h2>
            ${escapeHtml(
              reportTitle
            )}
          </h2>

          <div class="meta">
            Generated:
            ${escapeHtml(
              generatedAt
            )}
          </div>

          <div class="summary">

            <div class="summary-box">
              <div class="label">
                Total Loans
              </div>

              <div class="value">
                ${summary.totalLoans}
              </div>
            </div>

            <div class="summary-box">
              <div class="label">
                Total Principal
              </div>

              <div class="value">
                ${money(
                  summary.totalPrincipal
                )}
              </div>
            </div>

            <div class="summary-box">
              <div class="label">
                Outstanding Balance
              </div>

              <div class="value">
                ${money(
                  summary.outstandingBalance
                )}
              </div>
            </div>

            <div class="summary-box">
              <div class="label">
                Total Paid
              </div>

              <div class="value">
                ${money(
                  summary.totalPaid
                )}
              </div>
            </div>

            <div class="summary-box">
              <div class="label">
                Report Interest
              </div>

              <div class="value">
                ${money(
                  reportInterest
                )}
              </div>
            </div>

            <div class="summary-box">
              <div class="label">
                Report Repayments
              </div>

              <div class="value">
                ${money(
                  reportRepayments
                )}
              </div>
            </div>

          </div>

          ${content}

          <div class="footer">

            <strong>
              ${escapeHtml(
                companySettings?.company_name ||
                  "Umhlomunye Finance"
              )}
              — Confidential Report
            </strong>

            <br />

            Generated electronically by the
            loan management system.

          </div>

        </body>

      </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    setTimeout(async () => {
      await waitForPrintImages(
        printWindow
      );

      printWindow.print();
    }, 300);
  };

  /* =========================================================
     LOADING
  ========================================================= */

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack
          alignItems="center"
          spacing={2}
        >
          <CircularProgress />

          <Typography color="text.secondary">
            Loading reports...
          </Typography>
        </Stack>
      </Box>
    );
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <Box
      sx={{
        p: {
          xs: 2,
          md: 3,
        },
      }}
    >

      {/* PAGE HEADER */}

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
            fontWeight={800}
          >
            Reports
          </Typography>

          <Typography color="text.secondary">
            Financial and loan portfolio
            reporting
          </Typography>

        </Box>

        <Box
          sx={{
            width: "100%",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            mb: 2,
          }}
        >
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={exportCSV}
            size="small"
            sx={{
              height: 32,
              minHeight: 32,
              px: 1.5,
              fontSize: "0.8rem",
              whiteSpace: "nowrap",
            }}
          >
            Export CSV
          </Button>
        </Box>

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
            value={
              summary.totalLoans
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
          <StatCard
            title="Active Loans"
            value={
              summary.activeLoans
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
          <StatCard
            title="Total Principal"
            value={money(
              summary.totalPrincipal
            )}
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
              summary.outstandingBalance
            )}
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
            value={money(
              summary.totalPaid
            )}
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
            value={money(
              reportInterest
            )}
          />
        </Grid>

      </Grid>

      {/* MONTHLY + YEARLY REPORTS */}

      <FinancialPerformance
        loans={summary.loans}
        transactions={
          transactions
        }
        companySettings={
          companySettings
        }
      />

      {/* FILTERS */}

      <Card
        elevation={2}
        sx={{
          mb: 3,
          borderRadius: 3,
        }}
      >
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
            alignItems="center"
          >

            <Grid
              size={{
                xs: 12,
                md: 4,
              }}
            >
              <TextField
                fullWidth
                size="small"
                label="Search"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="Customer, loan, type..."
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
                size="small"
                type="date"
                label="From"
                value={dateFrom}
                onChange={(event) =>
                  setDateFrom(
                    event.target.value
                  )
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
                size="small"
                type="date"
                label="To"
                value={dateTo}
                onChange={(event) =>
                  setDateTo(
                    event.target.value
                  )
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
            >
              <Button
                fullWidth
                variant="outlined"
                onClick={
                  clearFilters
                }
              >
                Clear Filters
              </Button>
            </Grid>

          </Grid>

        </CardContent>
      </Card>

      {/* EXISTING REPORTS */}

      <Card
        elevation={2}
        sx={{
          borderRadius: 3,
        }}
      >
        <CardContent>

          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            justifyContent="space-between"
            alignItems={{
              xs: "flex-start",
              sm: "center",
            }}
            spacing={1}
            sx={{ mb: 2 }}
          >

            <Box>

              <Typography
                variant="h6"
                fontWeight={700}
              >
                {reportTitle}
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                {
                  filteredTransactions.length
                }{" "}
                transaction
                {
                  filteredTransactions.length ===
                  1
                    ? ""
                    : "s"
                }{" "}
                displayed
              </Typography>

            </Box>

            <Button
              size="small"
              variant="outlined"
              startIcon={
                <PrintIcon />
              }
              onClick={
                printReport
              }
            >
              Print Report
            </Button>

          </Stack>

          <Divider
            sx={{ mb: 2 }}
          />

          <Tabs
            value={tab}
            onChange={(_, value) =>
              setTab(value)
            }
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 3 }}
          >
            <Tab label="Transactions" />
            <Tab label="Repayments" />
            <Tab label="Interest" />
            <Tab label="Loan Portfolio" />
          </Tabs>

          {tab === 3 ? (
            <PortfolioTable
              loans={
                summary.loans
              }
            />
          ) : (
            <TransactionTable
              transactions={filteredTransactions.filter(
                (transaction) => {
                  const type =
                    String(
                      transaction?.transaction_type ||
                        ""
                    ).toLowerCase();

                  if (tab === 1) {
                    return (
                      type ===
                      "payment"
                    );
                  }

                  if (tab === 2) {
                    return (
                      type ===
                      "interest"
                    );
                  }

                  return true;
                }
              )}
            />
          )}

        </CardContent>
      </Card>

      <Alert
        severity="info"
        sx={{ mt: 3 }}
      >
        Financial reports are calculated
        from the loans and loan transaction
        records stored in Supabase. The
        financial performance section updates
        automatically through realtime
        database subscriptions.
      </Alert>

    </Box>
  );
}
