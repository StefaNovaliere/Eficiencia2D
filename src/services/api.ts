const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface UploadResponse {
  message: string;
  file_id: string;
  original_filename: string;
  summary: {
    walls: number;
    floors: number;
    discards: number;
    total_groups: number;
  };
  topology: any; // Mapped to Phase1Result in frontend
  preview_obj: string;
}

// Helper to convert snake_case keys to camelCase for the frontend TS interfaces
function toCamelCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => toCamelCase(v));
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      result[camelKey] = toCamelCase(obj[key]);
      return result;
    }, {} as any);
  }
  return obj;
}

export interface GenerateRequestPayload {
  file_id: string;
  original_filename: string;
  scale_denom?: number;
  paper?: string;
  overrides?: Record<number, string>;
  wall_wall_decisions?: Record<number, number>;
}

export interface GenerateResponse {
  message: string;
  generated_files: string[];
}

export async function uploadModelFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error del servidor: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.topology) {
    data.topology = toCamelCase(data.topology);
  }
  return data;
}

export async function uploadDemoObj(textContent: string, filename: string = "demo.obj"): Promise<UploadResponse> {
  const blob = new Blob([textContent], { type: "text/plain" });
  const file = new File([blob], filename, { type: "text/plain" });
  
  return uploadModelFile(file);
}

export async function generateProjectFiles(payload: GenerateRequestPayload): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al generar: ${res.statusText}`);
  }

  return res.json();
}
