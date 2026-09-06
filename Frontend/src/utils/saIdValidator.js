function luhnCheck(idNumber) {
  let sum = 0;
  let alternate = false;

  for (let i = idNumber.length - 1; i >= 0; i--) {
    let n = parseInt(idNumber.charAt(i), 10);

    if (alternate) {
      n *= 2;

      if (n > 9) {
        n -= 9;
      }
    }

    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

export function parseSouthAfricanId(idNumber) {
  if (!/^\d{13}$/.test(idNumber)) {
    return {
      valid: false,
      message: "ID number must contain exactly 13 digits.",
    };
  }

  if (!luhnCheck(idNumber)) {
    return {
      valid: false,
      message: "Invalid South African ID number.",
    };
  }

  const yy = Number(idNumber.substring(0, 2));
  const mm = Number(idNumber.substring(2, 4));
  const dd = Number(idNumber.substring(4, 6));

  const currentYY = new Date().getFullYear() % 100;

  const year = yy <= currentYY ? 2000 + yy : 1900 + yy;

  // Validate the calendar date without converting it to UTC
  const daysInMonth = new Date(year, mm, 0).getDate();

  if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth) {
    return {
      valid: false,
      message: "Invalid birth date in ID number.",
    };
  }

  // Build the date string directly from the ID.
  // This prevents timezone-related day shifting.
  const birthDate =
    `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

  const genderDigits = Number(idNumber.substring(6, 10));

  return {
    valid: true,
    birthDate,
    gender: genderDigits >= 5000 ? "Male" : "Female",
  };
}