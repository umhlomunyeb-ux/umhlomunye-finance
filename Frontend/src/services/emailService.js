import { supabase } from "../lib/supabase";

export async function sendLoanEmail(payload) {
  const { data, error } = await supabase.functions.invoke(
    "send-loan-email",
    {
      body: payload,
    }
  );

  if (error) {
    console.error("Email function error:", error);
    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error || "Email could not be sent."
    );
  }

  return data;
}