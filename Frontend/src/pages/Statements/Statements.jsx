import { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  Divider,
  Chip,
} from "@mui/material";

import QRCode from "qrcode";

import { getLoans } from "../../services/loanService";
import { getLoanStatement } from "../../services/statementService";

export default function Statements() {
  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadLoans();
  }, []);

  async function loadLoans() {
    try {
      const data = await getLoans();
      setLoans(data || []);
    } catch (err) {
      console.error("LOAD LOANS ERROR:", err);
    }
  }

  async function loadStatement() {
    if (!selectedLoanId) return;

    setLoading(true);

    try {
      const data = await getLoanStatement(selectedLoanId);
      setStatement(data);
    } catch (err) {
      console.error("LOAD STATEMENT ERROR:", err);
    } finally {
      setLoading(false);
    }
  }

  const selectedLoan = loans.find(
    (loan) => loan.id === selectedLoanId
  );

  function money(value) {
    return `R${Number(value || 0).toFixed(2)}`;
  }

  async function printStatement() {
    if (!selectedLoan || !statement) {
      return;
    }

    try {
      let qrCode = "";

      if (selectedLoan.statement_verification_token) {
        const verificationUrl =
          `${window.location.origin}/verify-statement/` +
          selectedLoan.statement_verification_token;

        qrCode = await QRCode.toDataURL(
          verificationUrl,
          {
            width: 180,
            margin: 1,
            errorCorrectionLevel: "H",
          }
        );
      }

      const customerName =
        `${selectedLoan.customers?.first_name || ""} ` +
        `${selectedLoan.customers?.last_name || ""}`.trim();

      const transactionRows =
        statement.transactions.length > 0
          ? statement.transactions
              .map(
                (trx) => `
                  <tr>
                    <td>
                      ${
                        trx.transaction_date
                          ? new Date(
                              trx.transaction_date
                            ).toLocaleDateString("en-ZA")
                          : "-"
                      }
                    </td>
                    <td>${trx.transaction_type || "-"}</td>
                    <td>${trx.description || "-"}</td>
                    <td class="right">
                      ${
                        Number(trx.debit || 0) > 0
                          ? money(trx.debit)
                          : "-"
                      }
                    </td>
                    <td class="right">
                      ${
                        Number(trx.credit || 0) > 0
                          ? money(trx.credit)
                          : "-"
                      }
                    </td>
                    <td class="right">
                      ${money(trx.balance)}
                    </td>
                  </tr>
                `
              )
              .join("")
          : `
              <tr>
                <td colspan="6" class="empty">
                  No transactions found.
                </td>
              </tr>
            `;

      const overdueRows =
        statement.overdues.length > 0
          ? statement.overdues
              .map(
                (overdue) => `
                  <tr>
                    <td>
                      ${overdue.cycle_payment_date}
                    </td>
                    <td>
                      ${overdue.overdue_start_date}
                    </td>
                    <td class="right">
                      ${money(overdue.overdue_amount)}
                    </td>
                    <td>
                      ${overdue.status || "-"}
                    </td>
                    <td>
                      ${overdue.resolved_date || "-"}
                    </td>
                  </tr>
                `
              )
              .join("")
          : `
              <tr>
                <td colspan="5" class="empty">
                  No overdue amounts.
                </td>
              </tr>
            `;

      const printWindow = window.open(
        "",
        "_blank",
        "width=1000,height=800"
      );

      if (!printWindow) {
        alert(
          "Please allow pop-ups in your browser to print the statement."
        );
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>

        <html>

        <head>

          <meta charset="UTF-8">

          <title>
            Loan Statement - ${selectedLoan.loan_number}
          </title>

          <style>

            @page {
              size: A4;
              margin: 15mm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              font-family: Arial, Helvetica, sans-serif;
              color: #222;
              font-size: 11px;
              background: white;
            }

            .page {
              width: 100%;
              max-width: 180mm;
              margin: auto;
            }

            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 3px solid #17365d;
              padding-bottom: 12px;
              margin-bottom: 18px;
            }

            .company-name {
              color: #17365d;
              font-size: 22px;
              font-weight: bold;
              margin-bottom: 4px;
            }

            .slogan {
              color: #666;
              font-size: 10px;
              font-style: italic;
              margin-bottom: 8px;
            }

            .company-details {
              color: #555;
              font-size: 9px;
              line-height: 1.6;
            }

            .qr {
              text-align: center;
              width: 100px;
            }

            .qr img {
              width: 90px;
              height: 90px;
            }

            .qr-text {
              font-size: 8px;
              color: #666;
              margin-top: 3px;
            }

            .title {
              text-align: center;
              margin-bottom: 18px;
            }

            .title h1 {
              margin: 0;
              color: #17365d;
              font-size: 19px;
            }

            .title p {
              margin-top: 5px;
              color: #666;
              font-size: 9px;
            }

            .section {
              margin-bottom: 18px;
            }

            .section-title {
              background: #17365d;
              color: white;
              padding: 7px 9px;
              font-weight: bold;
              font-size: 10px;
            }

            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              border: 1px solid #ddd;
            }

            .info {
              padding: 8px;
              border-bottom: 1px solid #ddd;
            }

            .info:nth-child(odd) {
              border-right: 1px solid #ddd;
            }

            .label {
              display: block;
              color: #777;
              font-size: 8px;
              text-transform: uppercase;
              margin-bottom: 3px;
            }

            .value {
              font-weight: bold;
              font-size: 10px;
            }

            .summary {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 6px;
              margin-top: 8px;
            }

            .summary-box {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: center;
            }

            .summary-label {
              font-size: 8px;
              color: #777;
            }

            .summary-value {
              color: #17365d;
              font-size: 11px;
              font-weight: bold;
              margin-top: 4px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
            }

            th {
              background: #eef2f6;
              border: 1px solid #ddd;
              padding: 6px;
              text-align: left;
              font-size: 8px;
            }

            td {
              border: 1px solid #ddd;
              padding: 6px;
              font-size: 8px;
            }

            .right {
              text-align: right;
            }

            .empty {
              text-align: center;
              color: #777;
              padding: 12px;
            }

            .verification {
              border: 1px solid #ccd5df;
              background: #f7f9fb;
              padding: 10px;
              text-align: center;
              margin-top: 20px;
              font-size: 8px;
              color: #555;
            }

            .footer {
              border-top: 1px solid #ddd;
              margin-top: 20px;
              padding-top: 10px;
              text-align: center;
              color: #777;
              font-size: 8px;
              line-height: 1.6;
            }

            .footer strong {
              color: #17365d;
            }

            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }

          </style>

        </head>

        <body>

          <div class="page">

            <div class="header">

              <div>

                <div class="company-name">
                  UMHLOMUNYE FINANCE
                </div>

                <div class="slogan">
                  "Our dreams, Our hope"
                </div>

                <div class="company-details">

                  Reg. No: 2020/191721/07<br>

                  20 Jacaranda Street,
                  Kinross, 2270<br>

                  Tel: 078 078 3879<br>

                  WhatsApp: 060 508 6672<br>

                  Email: umhlomunyeb@gmail.com

                </div>

              </div>

              ${
                qrCode
                  ? `
                    <div class="qr">

                      <img
                        src="${qrCode}"
                        alt="Verification QR Code"
                      >

                      <div class="qr-text">
                        Scan to verify
                      </div>

                    </div>
                  `
                  : ""
              }

            </div>


            <div class="title">

              <h1>
                LOAN ACCOUNT STATEMENT
              </h1>

              <p>
                Official statement issued by
                Umhlomunye Finance
              </p>

            </div>


            <div class="section">

              <div class="section-title">
                CUSTOMER & ACCOUNT INFORMATION
              </div>

              <div class="info-grid">

                <div class="info">

                  <span class="label">
                    Customer
                  </span>

                  <span class="value">
                    ${customerName || "-"}
                  </span>

                </div>

                <div class="info">

                  <span class="label">
                    Loan Number
                  </span>

                  <span class="value">
                    ${selectedLoan.loan_number}
                  </span>

                </div>

                <div class="info">

                  <span class="label">
                    Statement Date
                  </span>

                  <span class="value">
                    ${new Date().toLocaleDateString("en-ZA")}
                  </span>

                </div>

                <div class="info">

                  <span class="label">
                    Account Status
                  </span>

                  <span class="value">
                    ${selectedLoan.loan_status || "-"}
                  </span>

                </div>

              </div>

            </div>


            <div class="section">

              <div class="section-title">
                LOAN DETAILS
              </div>

              <div class="info-grid">

                <div class="info">

                  <span class="label">
                    Principal Amount
                  </span>

                  <span class="value">
                    ${money(
                      selectedLoan.principal_amount
                    )}
                  </span>

                </div>

                <div class="info">

                  <span class="label">
                    Interest Rate
                  </span>

                  <span class="value">
                    ${Number(
                      selectedLoan.interest_rate || 0
                    ).toFixed(2)}%
                  </span>

                </div>

                <div class="info">

                  <span class="label">
                    Total Repayment
                  </span>

                  <span class="value">
                    ${money(
                      selectedLoan.total_repayment
                    )}
                  </span>

                </div>

                <div class="info">

                  <span class="label">
                    Next Payment Date
                  </span>

                  <span class="value">
                    ${
                      selectedLoan.next_payment_date ||
                      "-"
                    }
                  </span>

                </div>

              </div>


              <div class="summary">

                <div class="summary-box">

                  <div class="summary-label">
                    PRINCIPAL
                  </div>

                  <div class="summary-value">
                    ${money(
                      selectedLoan.principal_amount
                    )}
                  </div>

                </div>

                <div class="summary-box">

                  <div class="summary-label">
                    TOTAL PAID
                  </div>

                  <div class="summary-value">
                    ${money(
                      selectedLoan.total_paid
                    )}
                  </div>

                </div>

                <div class="summary-box">

                  <div class="summary-label">
                    CURRENT BALANCE
                  </div>

                  <div class="summary-value">
                    ${money(
                      selectedLoan.current_balance
                    )}
                  </div>

                </div>

                <div class="summary-box">

                  <div class="summary-label">
                    STATUS
                  </div>

                  <div class="summary-value">
                    ${selectedLoan.loan_status || "-"}
                  </div>

                </div>

              </div>

            </div>


            <div class="section">

              <div class="section-title">
                TRANSACTION HISTORY
              </div>

              <table>

                <thead>

                  <tr>

                    <th>
                      Date
                    </th>

                    <th>
                      Type
                    </th>

                    <th>
                      Description
                    </th>

                    <th style="text-align:right">
                      Debit
                    </th>

                    <th style="text-align:right">
                      Credit
                    </th>

                    <th style="text-align:right">
                      Balance
                    </th>

                  </tr>

                </thead>

                <tbody>

                  ${transactionRows}

                </tbody>

              </table>

            </div>


            <div class="section">

              <div class="section-title">
                OVERDUE AMOUNTS
              </div>

              <table>

                <thead>

                  <tr>

                    <th>
                      Payment Date
                    </th>

                    <th>
                      Overdue From
                    </th>

                    <th style="text-align:right">
                      Amount
                    </th>

                    <th>
                      Status
                    </th>

                    <th>
                      Resolved Date
                    </th>

                  </tr>

                </thead>

                <tbody>

                  ${overdueRows}

                </tbody>

              </table>

            </div>


            <div class="verification">

              <strong>
                STATEMENT AUTHENTICITY
              </strong>

              <br><br>

              This statement contains a secure
              verification reference. Scan the QR code
              above to verify the statement against the
              Umhlomunye Finance loan management system.

            </div>


            <div class="footer">

              <strong>
                UMHLOMUNYE FINANCE
              </strong>

              <br>

              "Our dreams, Our hope"

              <br>

              This is an electronically generated
              statement and does not require a physical
              signature.

              <br>

              Reg. No: 2020/191721/07 |
              20 Jacaranda Street, Kinross, 2270 |
              078 078 3879 |
              060 508 6672

            </div>

          </div>

        </body>

        </html>
      `);

      printWindow.document.close();

      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);

    } catch (error) {
      console.error(
        "PRINT STATEMENT ERROR:",
        error
      );

      alert(
        "Unable to prepare the statement for printing."
      );
    }
  }

  return (
    <Box sx={{ p: 3 }}>

      <Typography
        variant="h4"
        gutterBottom
      >
        Loan Statements
      </Typography>


      <Paper sx={{ p: 3, mb: 3 }}>

        <Typography
          variant="h6"
          gutterBottom
        >
          Select Loan
        </Typography>


        <Box
          sx={{
            display: "flex",
            gap: 2,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >

          <TextField
            select
            label="Loan"
            value={selectedLoanId}
            onChange={(e) => {
              setSelectedLoanId(e.target.value);
              setStatement(null);
            }}
            slotProps={{
              select: {
                native: true,
              },
            }}
            sx={{ minWidth: 300 }}
          >

            <option value="">
              Select a loan
            </option>

            {loans.map((loan) => (

              <option
                key={loan.id}
                value={loan.id}
              >

                {loan.loan_number} -{" "}

                {loan.customers?.first_name || ""}{" "}

                {loan.customers?.last_name || ""}

              </option>

            ))}

          </TextField>


          <Button
            variant="contained"
            onClick={loadStatement}
            disabled={
              !selectedLoanId ||
              loading
            }
          >

            {loading
              ? "Loading..."
              : "View Statement"}

          </Button>


          <Button
            variant="outlined"
            onClick={printStatement}
            disabled={
              !selectedLoanId ||
              !statement ||
              loading
            }
          >

            Print Statement

          </Button>

        </Box>

      </Paper>


      {loading && (
        <CircularProgress />
      )}


      {selectedLoan && statement && (

        <>

          <Paper
            sx={{
              p: 3,
              mb: 3,
            }}
          >

            <Box
              sx={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 2,
              }}
            >

              <Typography variant="h5">
                Loan Statement
              </Typography>


              <Button
                variant="contained"
                onClick={printStatement}
              >

                Print Statement

              </Button>

            </Box>


            <Divider sx={{ my: 2 }} />


            <Typography>

              <strong>
                Loan Number:
              </strong>{" "}

              {selectedLoan.loan_number}

            </Typography>


            <Typography>

              <strong>
                Customer:
              </strong>{" "}

              {selectedLoan.customers?.first_name}{" "}

              {selectedLoan.customers?.last_name}

            </Typography>


            <Typography>

              <strong>
                Principal:
              </strong>{" "}

              {money(
                selectedLoan.principal_amount
              )}

            </Typography>


            <Typography>

              <strong>
                Current Balance:
              </strong>{" "}

              {money(
                selectedLoan.current_balance
              )}

            </Typography>


            <Typography>

              <strong>
                Total Paid:
              </strong>{" "}

              {money(
                selectedLoan.total_paid
              )}

            </Typography>


            <Typography sx={{ mt: 1 }}>

              <strong>
                Status:
              </strong>{" "}

              <Chip
                label={
                  selectedLoan.loan_status
                }
              />

            </Typography>

          </Paper>


          <Paper
            sx={{
              p: 3,
              mb: 3,
            }}
          >

            <Typography
              variant="h6"
              gutterBottom
            >
              Transactions
            </Typography>


            <Table>

              <TableHead>

                <TableRow>

                  <TableCell>
                    Date
                  </TableCell>

                  <TableCell>
                    Type
                  </TableCell>

                  <TableCell>
                    Description
                  </TableCell>

                  <TableCell align="right">
                    Debit
                  </TableCell>

                  <TableCell align="right">
                    Credit
                  </TableCell>

                  <TableCell align="right">
                    Balance
                  </TableCell>

                </TableRow>

              </TableHead>


              <TableBody>

                {statement.transactions.length === 0 ? (

                  <TableRow>

                    <TableCell
                      colSpan={6}
                      align="center"
                    >
                      No transactions found.
                    </TableCell>

                  </TableRow>

                ) : (

                  statement.transactions.map(
                    (trx) => (

                      <TableRow
                        key={trx.id}
                      >

                        <TableCell>

                          {trx.transaction_date
                            ? new Date(
                                trx.transaction_date
                              ).toLocaleDateString(
                                "en-ZA"
                              )
                            : "-"}

                        </TableCell>


                        <TableCell>
                          {trx.transaction_type}
                        </TableCell>


                        <TableCell>
                          {trx.description || "-"}
                        </TableCell>


                        <TableCell align="right">

                          {trx.debit
                            ? money(trx.debit)
                            : "-"}

                        </TableCell>


                        <TableCell align="right">

                          {trx.credit
                            ? money(trx.credit)
                            : "-"}

                        </TableCell>


                        <TableCell align="right">

                          {money(trx.balance)}

                        </TableCell>

                      </TableRow>

                    )
                  )

                )}

              </TableBody>

            </Table>

          </Paper>


          <Paper sx={{ p: 3 }}>

            <Typography
              variant="h6"
              gutterBottom
            >
              Overdue Amounts
            </Typography>


            <Table>

              <TableHead>

                <TableRow>

                  <TableCell>
                    Payment Date
                  </TableCell>

                  <TableCell>
                    Overdue From
                  </TableCell>

                  <TableCell align="right">
                    Amount
                  </TableCell>

                  <TableCell>
                    Status
                  </TableCell>

                  <TableCell>
                    Resolved Date
                  </TableCell>

                </TableRow>

              </TableHead>


              <TableBody>

                {statement.overdues.length === 0 ? (

                  <TableRow>

                    <TableCell
                      colSpan={5}
                      align="center"
                    >
                      No overdue amounts.
                    </TableCell>

                  </TableRow>

                ) : (

                  statement.overdues.map(
                    (overdue) => (

                      <TableRow
                        key={overdue.id}
                      >

                        <TableCell>
                          {overdue.cycle_payment_date}
                        </TableCell>

                        <TableCell>
                          {overdue.overdue_start_date}
                        </TableCell>

                        <TableCell align="right">

                          {money(
                            overdue.overdue_amount
                          )}

                        </TableCell>

                        <TableCell>

                          <Chip
                            label={
                              overdue.status
                            }
                            color={
                              overdue.status ===
                              "Resolved"
                                ? "success"
                                : "error"
                            }
                            size="small"
                          />

                        </TableCell>

                        <TableCell>

                          {overdue.resolved_date ||
                            "-"}

                        </TableCell>

                      </TableRow>

                    )
                  )

                )}

              </TableBody>

            </Table>

          </Paper>

        </>

      )}

    </Box>
  );
}
