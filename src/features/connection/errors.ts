export function normalizeConnectionError(error: string) {
  return error
    .replace(/^Error: /, "")
    .replace("recorder_unreachable", "Could not reach the recorder. Check its address and local network, then retry.")
    .replace("authentication_failed", "The recorder rejected this login. Re-enter the username or password.")
    .replace("password_expired", "Enter your recorder password to continue.")
    .replace("credential_store_unavailable", "The operating system credential store is unavailable. Turn off Remember password to connect for this session.");
}
