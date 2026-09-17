import QRCode from "qrcode";

import { supabase } from "../lib/supabase";

/**
 * ============================================================
 * PDF BRANDING / MASTER DOCUMENT TEMPLATE
 * ============================================================
 *
 * All system-generated PDFs should use this header.
 *
 * Layout:
 *   - Company logo: top-left
 *   - Company/contact information: beside logo
 *   - QR code: top-right
 *   - No standalone company-name document heading
 *
 * The statement layout is the master visual template.
 * ============================================================
 */

const DEFAULT_SETTINGS = {
  company_name: "",
  short_name: "",
  company_address: "",
  company_phone: "",
  company_whatsapp: "",
  company_email: "",
  company_logo_url: "",
  currency: "ZAR",
  timezone: "Africa/Johannesburg",
};

/**
 * ============================================================
 * SETTINGS
 * ============================================================
 */

async function getSystemSettings() {
  const { data, error } = await supabase
    .from("system_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("PDF SETTINGS ERROR:", error);
    return DEFAULT_SETTINGS;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(data || {}),
  };
}

/**
 * ============================================================
 * COMPANY INFORMATION
 * ============================================================
 */

export async function getPdfCompanyInfo() {
  const settings = await getSystemSettings();

  return {
    companyName:
      settings.company_name ||
      settings.companyName ||
      "",

    shortName:
      settings.short_name ||
      settings.shortName ||
      "",

    companyAddress:
      settings.company_address ||
      settings.companyAddress ||
      "",

    companyPhone:
      settings.company_phone ||
      settings.companyPhone ||
      settings.phone ||
      settings.telephone ||
      "",

    companyWhatsapp:
      settings.company_whatsapp ||
      settings.companyWhatsapp ||
      settings.whatsapp ||
      "",

    companyEmail:
      settings.company_email ||
      settings.companyEmail ||
      settings.email ||
      "",

    companyLogoUrl:
      settings.company_logo_url ||
      settings.companyLogoUrl ||
      settings.logo_url ||
      "",
  };
}

/**
 * ============================================================
 * LOGO
 * ============================================================
 */

export async function getPdfLogoDataUrl(logoUrl) {
  if (!logoUrl) {
    return null;
  }

  try {
    const response = await fetch(logoUrl);

    if (!response.ok) {
      throw new Error(
        `Unable to load company logo: ${response.status}`
      );
    }

    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        resolve(reader.result);
      };

      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("PDF LOGO ERROR:", error);
    return null;
  }
}

/**
 * ============================================================
 * QR CODE
 * ============================================================
 */

export async function getPdfQrDataUrl(
  verificationUrl
) {
  if (!verificationUrl) {
    return null;
  }

  try {
    return await QRCode.toDataURL(
      verificationUrl,
      {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 180,
      }
    );
  } catch (error) {
    console.error("PDF QR ERROR:", error);
    return null;
  }
}

/**
 * ============================================================
 * DRAW MASTER PDF HEADER
 * ============================================================
 *
 * This is the ONLY function individual PDF generators should
 * need to call for their company header and QR code.
 *
 * verificationUrl:
 *   URL encoded into the document QR code.
 *
 * Returns:
 *   companyInfo
 *   contentStartY
 * ============================================================
 */

export async function drawPdfCompanyHeader(
  pdf,
  verificationUrl = null
) {
  const companyInfo =
    await getPdfCompanyInfo();

  const companyLogoDataUrl =
    await getPdfLogoDataUrl(
      companyInfo.companyLogoUrl
    );

  const qrDataUrl =
    await getPdfQrDataUrl(
      verificationUrl
    );

  const pageWidth =
    pdf.internal.pageSize.getWidth();

  /*
   * ----------------------------------------------------------
   * MASTER HEADER DIMENSIONS
   * ----------------------------------------------------------
   */

  const leftMargin = 14;
  const topMargin = 10;

  const logoX = leftMargin;
  const logoY = topMargin;

  const logoWidth = 25;
  const logoHeight = 25;

  const informationX = 44;

  const qrSize = 30;
  const qrX =
    pageWidth -
    leftMargin -
    qrSize;

  const qrY = 10;

  /*
   * ----------------------------------------------------------
   * LOGO
   * ----------------------------------------------------------
   */

  if (companyLogoDataUrl) {
    try {
      pdf.addImage(
        companyLogoDataUrl,
        "PNG",
        logoX,
        logoY,
        logoWidth,
        logoHeight
      );
    } catch (error) {
      console.error(
        "PDF LOGO DRAW ERROR:",
        error
      );
    }
  }

  /*
   * ----------------------------------------------------------
   * COMPANY / CONTACT INFORMATION
   * ----------------------------------------------------------
   *
   * Intentionally DO NOT render companyName as a standalone
   * document heading.
   *
   * The company information appears as supporting information
   * beside the logo.
   * ----------------------------------------------------------
   */

  pdf.setFont(
    "helvetica",
    "normal"
  );

  pdf.setFontSize(8.5);

  let informationY = 13;

  const informationLines = [];

  if (companyInfo.companyAddress) {
    informationLines.push(
      companyInfo.companyAddress
    );
  }

  if (companyInfo.companyPhone) {
    informationLines.push(
      `Tel: ${companyInfo.companyPhone}`
    );
  }

  if (companyInfo.companyWhatsapp) {
    informationLines.push(
      `WhatsApp: ${companyInfo.companyWhatsapp}`
    );
  }

  if (companyInfo.companyEmail) {
    informationLines.push(
      `Email: ${companyInfo.companyEmail}`
    );
  }

  /*
   * Limit the text area so it does not overlap the QR code.
   */

  const maximumTextWidth =
    qrX -
    informationX -
    6;

  for (const line of informationLines) {
    const wrappedLines =
      pdf.splitTextToSize(
        line,
        Math.max(
          maximumTextWidth,
          60
        )
      );

    for (const wrappedLine of wrappedLines) {
      pdf.text(
        wrappedLine,
        informationX,
        informationY
      );

      informationY += 4;
    }
  }

  /*
   * ----------------------------------------------------------
   * QR CODE
   * ----------------------------------------------------------
   */

  if (qrDataUrl) {
    try {
      pdf.addImage(
        qrDataUrl,
        "PNG",
        qrX,
        qrY,
        qrSize,
        qrSize
      );

      pdf.setFontSize(6.5);
      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.text(
        "Scan to verify",
        qrX + qrSize / 2,
        qrY + qrSize + 4,
        {
          align: "center",
        }
      );
    } catch (error) {
      console.error(
        "PDF QR DRAW ERROR:",
        error
      );
    }
  }

  /*
   * ----------------------------------------------------------
   * HEADER SEPARATOR
   * ----------------------------------------------------------
   */

  pdf.setLineWidth(0.3);

  pdf.line(
    leftMargin,
    43,
    pageWidth - leftMargin,
    43
  );

  /*
   * ----------------------------------------------------------
   * DOCUMENT CONTENT START
   * ----------------------------------------------------------
   *
   * This keeps enough space below the standard header for
   * every generated document.
   * ----------------------------------------------------------
   */

  const contentStartY = 53;

  return {
    companyInfo,
    contentStartY,
  };
}

/**
 * ============================================================
 * GENERIC DOCUMENT VERIFICATION URL
 * ============================================================
 *
 * Used when a document has its own verification token.
 * ============================================================
 */

export function getPdfVerificationUrl(
  token,
  type = "document"
) {
  if (!token) {
    return null;
  }

  const baseUrl =
    window.location.origin;

  if (type === "statement") {
    return `${baseUrl}/verify-statement/${token}`;
  }

  if (type === "agreement") {
    return `${baseUrl}/verify-agreement/${token}`;
  }

  return `${baseUrl}/verify-document/${token}`;
}