import QRCode from "qrcode";

import { supabase } from "../lib/supabase";

/**
 * ============================================================
 * PDF BRANDING / MASTER DOCUMENT TEMPLATE
 * ============================================================
 *
 * Statement is the master visual template.
 *
 * All generated documents use:
 * - Plain white background
 * - Logo top-left
 * - Centralized company information
 * - QR code top-right
 * - Logo-derived accent colour divider
 * - Consistent spacing
 *
 * Individual documents remain responsible for their own
 * document-specific content.
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
 * LOGO ACCENT COLOUR
 * ============================================================
 */

export async function getLogoAccentColor(
  logoDataUrl
) {
  /*
   * Default neutral accent.
   * The actual company logo determines the document accent
   * whenever its image data can be analysed.
   */

  const fallback = [80, 80, 80];

  if (!logoDataUrl) {
    return fallback;
  }

  try {
    const image = await new Promise(
      (resolve, reject) => {
        const img = new Image();

        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = logoDataUrl;
      }
    );

    const canvas =
      document.createElement("canvas");

    const context =
      canvas.getContext("2d");

    if (!context) {
      return fallback;
    }

    canvas.width = Math.min(
      image.width || 100,
      100
    );

    canvas.height = Math.min(
      image.height || 100,
      100
    );

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const imageData =
      context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (
      let index = 0;
      index < imageData.data.length;
      index += 4
    ) {
      const alpha =
        imageData.data[index + 3];

      if (alpha < 50) {
        continue;
      }

      const r =
        imageData.data[index];

      const g =
        imageData.data[index + 1];

      const b =
        imageData.data[index + 2];

      /*
       * Ignore very light pixels because they are normally
       * background rather than the logo's accent.
       */

      if (
        r > 235 &&
        g > 235 &&
        b > 235
      ) {
        continue;
      }

      red += r;
      green += g;
      blue += b;
      count++;
    }

    if (!count) {
      return fallback;
    }

    return [
      Math.round(red / count),
      Math.round(green / count),
      Math.round(blue / count),
    ];
  } catch (error) {
    console.warn(
      "PDF LOGO ACCENT ERROR:",
      error
    );

    return fallback;
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
        width: 300,
      }
    );
  } catch (error) {
    console.error(
      "PDF QR ERROR:",
      error
    );

    return null;
  }
}

/**
 * ============================================================
 * MASTER PDF HEADER
 * ============================================================
 *
 * This matches the Statement PDF header.
 *
 * Every generated document should use this function.
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

  const accent =
    await getLogoAccentColor(
      companyLogoDataUrl
    );

  const qrTarget =
    verificationUrl ||
    (
      typeof window !== "undefined"
        ? window.location.href
        : ""
    );

  const qrDataUrl =
    await getPdfQrDataUrl(
      qrTarget
    );

  const pageWidth =
    pdf.internal.pageSize.getWidth();

  /*
   * ==========================================================
   * COMPANY LOGO — TOP LEFT
   * ==========================================================
   */

  if (companyLogoDataUrl) {
    try {
      pdf.addImage(
        companyLogoDataUrl,
        "AUTO",
        14,
        10,
        34,
        34
      );
    } catch (error) {
      console.warn(
        "PDF LOGO DRAW ERROR:",
        error
      );
    }
  }

  /*
   * ==========================================================
   * COMPANY INFORMATION — BESIDE LOGO
   * ==========================================================
   */

  const companyInfoLines = [
    companyInfo.companyName,
    companyInfo.companyAddress,
    companyInfo.companyPhone
      ? `Tel: ${companyInfo.companyPhone}`
      : "",
    companyInfo.companyWhatsapp
      ? `WhatsApp: ${companyInfo.companyWhatsapp}`
      : "",
    companyInfo.companyEmail
      ? `Email: ${companyInfo.companyEmail}`
      : "",
  ].filter(Boolean);

  const companyInfoX = 54;
  const companyInfoWidth = 100;

  let textY = 15;

  companyInfoLines.forEach(
    (line, index) => {
      pdf.setFont(
        "helvetica",
        index === 0
          ? "bold"
          : "normal"
      );

      pdf.setFontSize(
        index === 0
          ? 9
          : 7.8
      );

      const wrapped =
        pdf.splitTextToSize(
          String(line),
          companyInfoWidth
        );

      pdf.text(
        wrapped,
        companyInfoX,
        textY
      );

      textY +=
        wrapped.length * 3.8 + 0.8;
    }
  );

  /*
   * ==========================================================
   * QR CODE — TOP RIGHT
   * ==========================================================
   */

  if (qrDataUrl) {
    try {
      pdf.addImage(
        qrDataUrl,
        "PNG",
        165,
        10,
        31,
        31
      );

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.setFontSize(7);

      pdf.text(
        verificationUrl
          ? "Scan to verify"
          : "Scan to open",
        180.5,
        45,
        {
          align: "center",
        }
      );
    } catch (error) {
      console.warn(
        "PDF QR ERROR:",
        error
      );
    }
  }

  /*
   * ==========================================================
   * ACCENT DIVIDER
   * ==========================================================
   */

  const dividerY =
    Math.max(
      51,
      textY + 3
    );

  pdf.setDrawColor(
    ...accent
  );

  pdf.setLineWidth(0.8);

  pdf.line(
    14,
    dividerY,
    pageWidth - 14,
    dividerY
  );

  /*
   * ==========================================================
   * CONTENT START
   * ==========================================================
   */

  return {
    companyInfo,
    contentStartY:
      dividerY + 10,
    accent,
  };
}

/**
 * ============================================================
 * GENERIC DOCUMENT VERIFICATION URL
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