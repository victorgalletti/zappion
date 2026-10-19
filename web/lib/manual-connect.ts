// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import { callFunction } from "./supabase";

export interface ManualConnectFields {
  label: string;
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  register: boolean;
  pin: string;
  callback_url: string;
  verify_token: string;
}

export const emptyManualConnectFields: ManualConnectFields = {
  label: "", phone_number_id: "", waba_id: "", access_token: "", register: false,
  pin: "", callback_url: "", verify_token: "",
};

export function validateManualConnect(fields: ManualConnectFields, hasSystemToken = false): string | null {
  if (!/^\d+$/.test(fields.phone_number_id.trim())) return getT().manualConnect.enterAValidPhoneNumberIdUsingOnly;
  if (!/^\d+$/.test(fields.waba_id.trim())) return getT().manualConnect.enterAValidWabaIdUsingOnlyDigits;
  if (!hasSystemToken && !fields.access_token.trim()) return getT().manualConnect.enterThePermanentAccessToken;
  if (fields.register && !/^\d{6}$/.test(fields.pin)) return getT().manualConnect.enterThe6DigitTwoStepVerificationPin;
  if (fields.label.trim().length > 100) return getT().manualConnect.theInstanceNameMustBe100CharactersOr;
  if (fields.callback_url.trim()) {
    try {
      const url = new URL(fields.callback_url.trim());
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { return getT().manualConnect.enterAValidHttpsCallbackUrlWithoutCredentials; }
  }
  return null;
}

export function manualConnectError(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : "";
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(secret).join(getT().manualConnect.hidden);
  if (/access.?token|oauth|session.*expired|HTTP 401/i.test(message)) return getT().manualConnect.invalidOrExpiredTokenCheckThePermanentSystem;
  if (/pin|two.step|verification.*code|133005/i.test(message)) return getT().manualConnect.incorrectPinCheckTheNumberS6Digit;
  if (/does not belong|not.*belong|não pertence|outside.*waba|fora.*waba/i.test(message)) return getT().manualConnect.theNumberDoesNotBelongToTheSpecified;
  if (/forbidden|permission|admin|owner|HTTP 403/i.test(message)) return getT().manualConnect.youMustBeAnAdministratorOrOwnerAnd;
  if (/fetch|network|HTTP 5\d\d/i.test(message)) return getT().manualConnect.couldNotConnectRightNowCheckYourConnection;
  return message ? getT().manualConnect.couldNotConnectTheNumber(message) : getT().manualConnect.connectionFailed;
}

export async function manualConnect(organizationId: string, fields: ManualConnectFields, hasSystemToken = false): Promise<void> {
  const validation = validateManualConnect(fields, hasSystemToken);
  if (validation) throw new Error(validation);
  try {
    await callFunction("whatsapp-management/manual-connect", "POST", {
      organization_id: organizationId,
      phone_number_id: fields.phone_number_id.trim(), waba_id: fields.waba_id.trim(),
      ...(fields.access_token.trim() ? { access_token: fields.access_token.trim() } : {}), register: fields.register,
      ...(fields.register ? { pin: fields.pin } : {}),
      ...(fields.label.trim() ? { label: fields.label.trim() } : {}),
      ...(fields.callback_url.trim() ? { callback_url: fields.callback_url.trim() } : {}),
      ...(fields.verify_token.trim() ? { verify_token: fields.verify_token.trim() } : {}),
    });
  } catch (error) {
    throw new Error(manualConnectError(error, [fields.access_token, fields.access_token.trim(), fields.verify_token, fields.pin]));
  }
}
