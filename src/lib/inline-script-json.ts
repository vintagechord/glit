/**
 * JSON for an inline script must not contain an HTML parser terminator. JSON
 * escaping alone leaves `<` untouched, allowing `</script>` to break out of
 * the script element before JavaScript parsing begins.
 */
export const serializeInlineScriptJson = (value: unknown) =>
  (JSON.stringify(value) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
