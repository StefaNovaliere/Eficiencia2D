import type { AssemblyPreviewData } from "@/services/api";
import { normalizeAssemblyGuide } from "@/services/api";

/** Reads `guia_ensamble.json` from a generate ZIP (base64). */
export async function extractAssemblyGuideFromZip(
  zipBase64: string,
): Promise<AssemblyPreviewData | null> {
  const JSZip = (await import("jszip")).default;
  const binary = atob(zipBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const zip = await JSZip.loadAsync(bytes);
  const entryName = Object.keys(zip.files).find(
    (name) =>
      !zip.files[name].dir &&
      name.toLowerCase().includes("guia_ensamble") &&
      name.toLowerCase().endsWith(".json"),
  );
  if (!entryName) return null;

  const text = await zip.files[entryName].async("string");
  return normalizeAssemblyGuide(JSON.parse(text));
}
