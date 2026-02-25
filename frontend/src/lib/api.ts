const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface UploadOptions {
  file: File;
  scale: number;
  paper: string;
  formats: string[];
  onProgress?: (pct: number) => void;
}

/**
 * Upload a .skp file to the backend and return a Blob of the ZIP result.
 */
export async function uploadSkp(opts: UploadOptions): Promise<Blob> {
  const form = new FormData();
  form.append("file", opts.file);
  form.append("scale", String(opts.scale));
  form.append("paper", opts.paper);
  form.append("formats", opts.formats.join(","));

  const xhr = new XMLHttpRequest();

  return new Promise<Blob>((resolve, reject) => {
    xhr.open("POST", `${API_BASE}/api/upload`);
    xhr.responseType = "blob";

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as Blob);
      } else {
        // Try to extract error message from JSON response.
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const err = JSON.parse(reader.result as string);
            reject(new Error(err.detail || `Server error ${xhr.status}`));
          } catch {
            reject(new Error(`Server error ${xhr.status}`));
          }
        };
        reader.onerror = () => reject(new Error(`Server error ${xhr.status}`));
        reader.readAsText(xhr.response);
      }
    };

    xhr.onerror = () => reject(new Error("Network error — is the server running?"));
    xhr.send(form);
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    return data.status === "ok" && data.translator === true;
  } catch {
    return false;
  }
}
